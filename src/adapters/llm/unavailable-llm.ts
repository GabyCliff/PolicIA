import type { ChatEvent, ExplanationOutcome, LlmPort } from "@/shared/ports";

/**
 * The no-API-key adapter.
 *
 * PROMPT §1 principle 4 ("demo-proof"): Radar must boot, render, and demo
 * without `ANTHROPIC_API_KEY`. This implementation is what makes that true —
 * it degrades instead of throwing, so the alert use case falls back to the
 * deterministic template and the chat route reports a disabled chat rather
 * than a 500.
 */

export const LLM_UNAVAILABLE_MESSAGE =
  "Ask Radar is disabled because ANTHROPIC_API_KEY is not configured. Forecasts, alerts, and memory still work: alert explanations fall back to deterministic templates.";

export function createUnavailableLlm(model: string): LlmPort {
  return {
    available: false,
    model,
    explainAlert(): Promise<ExplanationOutcome> {
      return Promise.resolve({
        status: "failed",
        reason: "unavailable",
        detail: "ANTHROPIC_API_KEY is not configured",
        attempts: 0,
        calls: [],
      });
    },
    async *chat(): AsyncIterable<ChatEvent> {
      yield { type: "error", message: LLM_UNAVAILABLE_MESSAGE };
      yield { type: "done", stopReason: null, calls: [] };
    },
  };
}
