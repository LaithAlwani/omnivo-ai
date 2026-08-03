// -----------------------------------------------------------------------------
// Our cost of goods — estimated Anthropic spend per model, used to compute each
// conversation's cost and each client's margin (credits billed − our cost).
// Pure module (no imports) so it's usable from any runtime.
//
// Rates are USD per 1,000,000 tokens. VERIFY / UPDATE against Anthropic's current
// pricing page — these are the numbers that decide our reported margin.
// -----------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface ModelRates {
  input: number; // $ / 1M input tokens
  output: number; // $ / 1M output tokens
  cacheWrite: number; // $ / 1M cache-write tokens
  cacheRead: number; // $ / 1M cache-read tokens
}

// TODO(pricing): confirm these against https://www.anthropic.com/pricing.
const MODEL_RATES: Record<string, ModelRates> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

const DEFAULT_RATES: ModelRates = MODEL_RATES["claude-haiku-4-5"];

/** Our estimated cost in cents (may be fractional) for a model's token usage. */
export function estimateCostCents(model: string, usage: TokenUsage): number {
  const r = MODEL_RATES[model] ?? DEFAULT_RATES;
  const dollars =
    (usage.inputTokens / 1_000_000) * r.input +
    (usage.outputTokens / 1_000_000) * r.output +
    ((usage.cacheReadTokens ?? 0) / 1_000_000) * r.cacheRead +
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * r.cacheWrite;
  return dollars * 100;
}
