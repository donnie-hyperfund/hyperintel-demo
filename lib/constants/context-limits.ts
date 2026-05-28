/**
 * Context limits — shared between FE and BE.
 *
 * MAX_CONTEXT_TOKENS_UI: usage bar denominator. The model is configured with a 1M
 * context window, but the UI shows usage against 500k to nudge users toward shorter
 * contexts for better AI output quality — the model still accepts up to 1M.
 * CONTEXT_GATE_WARNING_TOKENS: soft gate — FE shows warning modal, BE routes to Sonnet.
 * CONTEXT_GATE_HARD_TOKENS: hard gate — phase transition required.
 */

export const MAX_CONTEXT_TOKENS_UI = 500_000;
export const CONTEXT_GATE_WARNING_TOKENS = 800_000;
export const CONTEXT_GATE_HARD_TOKENS = 900_000;
