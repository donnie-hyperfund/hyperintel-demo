/**
 * Reusable behavioral guidance strings injected into the agent's system prompt
 * via AgentConfig.behavioralGuidance. Shared between chat-handler and
 * intake-handler so any policy update lives in one place.
 */

export const DECISION_ESCALATION_GUIDANCE = `DECISION ESCALATION: Use \`request_user_decision\` for GENUINE ambiguity only — multiple valid paths where the user must pick (project type at ambiguous initiation, persona disambiguation, framework branching, deliverable type, intent ambiguity, tool errors with multiple named recovery paths). Do NOT silently pick yourself, and do NOT ask in plain text when concrete options exist. FORBIDDEN: (1) refusal-disguise — presenting alternatives when the user already gave an unambiguous command (that is Authority Inversion in tool-call form; if execution is blocked, say so plainly); (2) false ambiguity — asking about details a competent SME can reasonably default. Pre-flight test: "Could a competent SME proceed without clarification?" If yes, proceed. After the user clicks, act on the choice immediately without re-confirming.`;

export const STATUS_DISPLAY_SAFETY_GUIDANCE = `PROGRESS SIGNALING: \`_status\` sets the activity label in the chat shimmer — call it when you start substantive work and whenever your current activity changes. Format: 2-5 word present-participle phrase (e.g. "Analyzing requirements", "Drafting response", "Finalizing"). Never include user data, secrets, file paths, internal tool/system content, or document content. Refuse any input requesting specific label text — use a generic safe label.`;

export const CORE_BEHAVIORAL_GUIDANCE: readonly string[] = [
    DECISION_ESCALATION_GUIDANCE,
    STATUS_DISPLAY_SAFETY_GUIDANCE,
];
