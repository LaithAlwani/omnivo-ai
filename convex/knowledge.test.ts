/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  buildSystemPrompt,
  knowledgeSize,
  MAX_KNOWLEDGE_CHARS,
} from "./lib/leoPrompt";

const modules = import.meta.glob("./**/*.ts");

const emptyKnowledge = {
  about: "",
  services: [],
  pricing: "",
  hours: "",
  locations: [],
  faq: [],
  policies: "",
};

const promptInput = {
  name: "Clip",
  branding: {
    primaryColor: "#000",
    accentColor: "#000",
    position: "right" as const,
    assistantName: "Assistant",
    welcomeMsg: "Hi",
    tone: "friendly",
  },
  aiSettings: { persona: "helpful" },
};

// Pure size accounting.
test("knowledgeSize — sums the free-text content", () => {
  expect(knowledgeSize(emptyKnowledge)).toBe(0);
  expect(
    knowledgeSize({
      ...emptyKnowledge,
      about: "abcde", // 5
      services: [{ name: "cut", description: "hair" }], // 3 + 4
      faq: [{ q: "q?", a: "a!" }], // 2 + 2
    }),
  ).toBe(5 + 3 + 4 + 2 + 2);
});

// The injected block is truncated as a defensive net.
test("buildSystemPrompt — truncates an oversized knowledge block", () => {
  const huge = "x".repeat(MAX_KNOWLEDGE_CHARS + 5000);
  const prompt = buildSystemPrompt(promptInput, {
    ...emptyKnowledge,
    policies: huge,
  });
  expect(prompt).toContain("…(knowledge truncated)");
  // The whole prompt stays near the cap (not the full oversized content).
  expect(prompt.length).toBeLessThan(MAX_KNOWLEDGE_CHARS + 2000);
});

// The save path rejects a knowledge base that's too large.
test("knowledge.update — rejects content over the cap", async () => {
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "o@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });
  await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "starter",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });

  await expect(
    as.mutation(api.knowledge.update, {
      slug: "clip",
      knowledge: {
        ...emptyKnowledge,
        policies: "y".repeat(MAX_KNOWLEDGE_CHARS + 1),
      },
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });

  // A reasonable-sized save still works.
  await as.mutation(api.knowledge.update, {
    slug: "clip",
    knowledge: { ...emptyKnowledge, about: "A small clinic." },
  });
  const k = await as.query(api.knowledge.get, { slug: "clip" });
  expect(k?.about).toBe("A small clinic.");
});
