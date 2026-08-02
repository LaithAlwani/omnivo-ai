import type { Doc } from "../_generated/dataModel";

// -----------------------------------------------------------------------------
// Per-tenant system prompt for the assistant ("Leo"). Grounded in the business's
// branding + persona, and — when present — its knowledge base (services, hours,
// pricing, FAQs, policies) so the assistant answers from real facts.
// -----------------------------------------------------------------------------

type PromptInput = {
  name: string;
  branding: Doc<"businesses">["branding"];
  aiSettings: Doc<"businesses">["aiSettings"];
};

export type KnowledgeContent = {
  about: string;
  services: { name: string; description?: string }[];
  pricing: string;
  hours: string;
  locations: { name?: string; address: string; phone?: string }[];
  faq: { q: string; a: string }[];
  policies: string;
};

// The whole knowledge base is injected into every prompt (no retrieval yet), so
// we bound it: the save path rejects anything larger, and the prompt builder
// truncates as a defensive net (for pre-existing/imported rows). ~40k chars is
// ~10k tokens — far more than a curated form needs, but a hard ceiling against
// runaway growth. When knowledge routinely approaches this, move to embeddings +
// vector-search retrieval (inject only the top-k relevant chunks).
export const MAX_KNOWLEDGE_CHARS = 40_000;

/** Total size of a knowledge base's free-text content (for the save-time cap). */
export function knowledgeSize(k: KnowledgeContent): number {
  let n = k.about.length + k.pricing.length + k.hours.length + k.policies.length;
  for (const s of k.services) n += s.name.length + (s.description?.length ?? 0);
  for (const l of k.locations)
    n += (l.name?.length ?? 0) + l.address.length + (l.phone?.length ?? 0);
  for (const f of k.faq) n += f.q.length + f.a.length;
  return n;
}

function knowledgeBlock(k: KnowledgeContent): string {
  const parts: string[] = [];
  if (k.about.trim()) parts.push(`About:\n${k.about.trim()}`);
  if (k.services.length) {
    parts.push(
      "Services:\n" +
        k.services
          .map((s) => `- ${s.name}${s.description ? ` — ${s.description}` : ""}`)
          .join("\n"),
    );
  }
  if (k.pricing.trim()) parts.push(`Pricing:\n${k.pricing.trim()}`);
  if (k.hours.trim()) parts.push(`Hours:\n${k.hours.trim()}`);
  if (k.locations.length) {
    parts.push(
      "Locations:\n" +
        k.locations
          .map(
            (l) =>
              `- ${l.name ? `${l.name}: ` : ""}${l.address}${l.phone ? ` (${l.phone})` : ""}`,
          )
          .join("\n"),
    );
  }
  if (k.policies.trim()) parts.push(`Policies:\n${k.policies.trim()}`);
  if (k.faq.length) {
    parts.push(
      "FAQ:\n" + k.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n"),
    );
  }
  const block = parts.join("\n\n");
  // Defensive cap — the more important sections are rendered first, so any
  // overflow (usually long FAQs) is what gets trimmed.
  return block.length <= MAX_KNOWLEDGE_CHARS
    ? block
    : block.slice(0, MAX_KNOWLEDGE_CHARS) + "\n\n…(knowledge truncated)";
}

export function buildSystemPrompt(
  business: PromptInput,
  knowledge?: KnowledgeContent | null,
): string {
  const { branding, aiSettings } = business;
  const block = knowledge ? knowledgeBlock(knowledge) : "";

  return [
    `You are ${branding.assistantName}, the AI assistant for ${business.name}.`,
    aiSettings.persona,
    `Write in this tone: ${branding.tone}.`,
    aiSettings.guardrails ? `Guardrails: ${aiSettings.guardrails}` : "",
    block
      ? `Here is everything you know about ${business.name} — treat it as your source of truth:\n\n${block}`
      : "",
    `Answer only from what you actually know about ${business.name}. If a question is outside your scope or the information above doesn't cover it, say so plainly and offer to connect the visitor with the team — never invent hours, prices, or policies. Keep replies concise, warm, and helpful.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
