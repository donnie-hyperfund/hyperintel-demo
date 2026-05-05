/**
 * Context limits — shared between FE and BE.
 *
 * MODEL_CONTEXT_TOKENS: the model's effective context window (usage bar denominator).
 * CONTEXT_GATE_WARNING_TOKENS: soft gate — FE shows warning modal, BE routes to Sonnet.
 * CONTEXT_GATE_HARD_TOKENS: hard gate — phase transition required.
 */

export const MAX_CONTEXT_TOKENS = 200_000;
export const CONTEXT_GATE_WARNING_TOKENS = 180_000;
export const CONTEXT_GATE_HARD_TOKENS = 300_000;
