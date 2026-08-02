"use node";

import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { appError } from "./lib/errors";

// -----------------------------------------------------------------------------
// Onboarding autofill — given a company website, crawl its public (ungated)
// pages, and have Claude extract a starter business profile (about, services,
// hours, pricing, FAQ) that pre-fills the create-a-business wizard. The user
// reviews/edits before saving, so this is a best-effort head start, never
// authoritative. Auth-gated (only a signed-in user mid-onboarding can call it).
// -----------------------------------------------------------------------------

const PER_FETCH_TIMEOUT_MS = 8_000;
const MAX_PAGES = 8; // homepage + up to 7 discovered pages
const PER_PAGE_CHARS = 6_000;
const TOTAL_CHARS = 45_000;
const CONCURRENCY = 4;

// Paths that suggest informative content — crawled first.
const PRIORITY = [
  "about",
  "service",
  "pricing",
  "price",
  "plan",
  "menu",
  "faq",
  "contact",
  "hour",
  "team",
  "location",
  "book",
  "appointment",
  "treatment",
  "product",
];
// Gated / non-content paths — skipped ("ungated routes only").
const GATED = [
  "login",
  "signin",
  "sign-in",
  "log-in",
  "logout",
  "account",
  "admin",
  "wp-admin",
  "wp-login",
  "cart",
  "checkout",
  "dashboard",
  "my-account",
  "portal",
  "register",
  "password",
];
const ASSET_RE =
  /\.(pdf|jpe?g|png|gif|svg|webp|avif|zip|mp4|mp3|mov|css|js|ico|xml|json|woff2?|ttf|eot)$/i;

/** Strip a fetched HTML document down to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OmnivoAI-Onboarding/1.0" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort HTML fetch → text; null on failure or non-HTML. */
async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, PER_FETCH_TIMEOUT_MS);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return null;
    }
    return htmlToText(await res.text());
  } catch {
    return null;
  }
}

/** Same-origin, non-asset, non-gated links from a page's HTML. */
function extractLinks(html: string, base: string, origin: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (ASSET_RE.test(u.pathname)) continue;
    const p = u.pathname.toLowerCase();
    if (GATED.some((g) => p.includes(g))) continue;
    u.hash = "";
    u.search = "";
    out.add(u.toString());
  }
  return [...out];
}

/** Simplified robots.txt: disallowed path prefixes for `User-agent: *`. */
async function disallowedPaths(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, 4000);
    if (!res.ok) return [];
    const lines = (await res.text()).split(/\r?\n/);
    const dis: string[] = [];
    let applies = false;
    for (const raw of lines) {
      const line = raw.trim();
      const low = line.toLowerCase();
      if (low.startsWith("user-agent:")) {
        applies = line.slice(11).trim() === "*";
      } else if (applies && low.startsWith("disallow:")) {
        const path = line.slice(9).trim();
        if (path && path !== "/") dis.push(path);
      }
    }
    return dis;
  } catch {
    return [];
  }
}

function priorityScore(url: string): number {
  try {
    const p = new URL(url).pathname.toLowerCase();
    return PRIORITY.reduce((s, k) => (p.includes(k) ? s + 1 : s), 0);
  } catch {
    return 0;
  }
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

const PROFILE_TOOL: Anthropic.Tool = {
  name: "business_profile",
  description:
    "Return a structured starter profile for this business, extracted ONLY from the provided website text. Leave a field empty if the site doesn't clearly state it — never invent details.",
  input_schema: {
    type: "object",
    properties: {
      businessName: { type: "string", description: "The business's name." },
      about: {
        type: "string",
        description: "A 1–3 sentence summary of what the business does.",
      },
      tone: {
        type: "string",
        description:
          "A short phrase describing the brand's voice (e.g. 'warm, friendly, professional').",
      },
      hours: { type: "string", description: "Opening hours, if stated." },
      pricing: {
        type: "string",
        description: "A short summary of pricing, if stated.",
      },
      services: {
        type: "array",
        description: "The main services or offerings.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
          },
          required: ["name"],
        },
      },
      faq: {
        type: "array",
        description: "A few likely customer questions with answers from the site.",
        items: {
          type: "object",
          properties: { q: { type: "string" }, a: { type: "string" } },
          required: ["q", "a"],
        },
      },
    },
    required: ["businessName", "about"],
  },
};

export const fromWebsite = action({
  args: { url: v.string() },
  returns: v.object({
    businessName: v.string(),
    about: v.string(),
    tone: v.string(),
    hours: v.string(),
    pricing: v.string(),
    services: v.array(v.object({ name: v.string(), description: v.string() })),
    faq: v.array(v.object({ q: v.string(), a: v.string() })),
    pagesRead: v.number(),
  }),
  handler: async (ctx, { url }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) appError("UNAUTHENTICATED", "Please sign in to continue.");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      appError("CONFIG", "The assistant isn't configured — set ANTHROPIC_API_KEY.");
    }

    // Normalize + validate the URL (default to https, http(s) only).
    let target: URL;
    try {
      target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url.trim()}`);
    } catch {
      appError("INVALID_INPUT", "Enter a valid website address, e.g. acme.com.");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      appError("INVALID_INPUT", "The website must start with http:// or https://.");
    }

    // Fetch the homepage (also resolves redirects → the real origin).
    let homeRes: Response;
    try {
      homeRes = await fetchWithTimeout(target.toString(), PER_FETCH_TIMEOUT_MS);
    } catch {
      appError("NOT_FOUND", "Couldn't reach that website. Check the address and retry.");
    }
    if (!homeRes.ok) {
      appError("NOT_FOUND", `Couldn't load that site (HTTP ${homeRes.status}).`);
    }
    const homeHtml = await homeRes.text();
    const finalUrl = new URL(homeRes.url || target.toString());
    const origin = finalUrl.origin;

    // Discover public pages: same-origin links, minus robots-disallowed + gated,
    // prioritizing the informative ones.
    const dis = await disallowedPaths(origin);
    const links = extractLinks(homeHtml, finalUrl.toString(), origin)
      .filter((u) => u !== finalUrl.toString())
      .filter((u) => {
        const p = new URL(u).pathname;
        return !dis.some((d) => p.startsWith(d));
      })
      .sort((a, b) => priorityScore(b) - priorityScore(a))
      .slice(0, MAX_PAGES - 1);

    // Fetch the discovered pages (bounded concurrency).
    const fetched = await mapPool(links, CONCURRENCY, async (u) => {
      const text = await fetchPageText(u);
      return text ? { url: u, text } : null;
    });

    const pages: { url: string; text: string }[] = [
      { url: finalUrl.toString(), text: htmlToText(homeHtml) },
      ...fetched.filter((p): p is { url: string; text: string } => !!p),
    ];

    // Combine within a total budget, labeling each page by its path.
    let combined = "";
    let pagesUsed = 0;
    for (const pg of pages) {
      if (combined.length >= TOTAL_CHARS) break;
      const room = TOTAL_CHARS - combined.length;
      const chunk = pg.text.slice(0, Math.min(PER_PAGE_CHARS, room)).trim();
      if (!chunk) continue;
      const path = new URL(pg.url).pathname || "/";
      combined += `\n\n## Page: ${path}\n${chunk}`;
      pagesUsed++;
    }
    combined = combined.trim();
    if (combined.length < 40) {
      appError(
        "INVALID_INPUT",
        "That site didn't have enough readable text to summarize (it may be JavaScript-only).",
      );
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1500,
      tools: [PROFILE_TOOL],
      tool_choice: { type: "tool", name: "business_profile" },
      messages: [
        {
          role: "user",
          content: `Below is text from ${pagesUsed} page(s) of ${finalUrl.hostname}. Extract one combined starter business profile using the business_profile tool. Merge details across pages; only use facts present in the text.\n${combined}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "tool_use");
    const out = (block && "input" in block ? block.input : {}) as Record<
      string,
      unknown
    >;

    const str = (x: unknown) => (typeof x === "string" ? x : "");
    const services = Array.isArray(out.services)
      ? out.services
          .map((s) => {
            const o = s as Record<string, unknown>;
            return { name: str(o.name), description: str(o.description) };
          })
          .filter((s) => s.name)
          .slice(0, 12)
      : [];
    const faq = Array.isArray(out.faq)
      ? out.faq
          .map((f) => {
            const o = f as Record<string, unknown>;
            return { q: str(o.q), a: str(o.a) };
          })
          .filter((f) => f.q && f.a)
          .slice(0, 8)
      : [];

    return {
      businessName: str(out.businessName),
      about: str(out.about),
      tone: str(out.tone),
      hours: str(out.hours),
      pricing: str(out.pricing),
      services,
      faq,
      pagesRead: pagesUsed,
    };
  },
});
