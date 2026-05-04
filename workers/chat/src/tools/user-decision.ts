import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { z } from 'zod';
import type { DecisionOption, StreamEvent } from '@/lib/schema/stream';
import type { ChatStreamDOStub } from '../utils/do-stubs';
import type { Pusher } from '../utils/stream-utils';

// ============================================================================
// CONTEXT
// ============================================================================

export interface UserDecisionContext {
    /** Pusher used to emit the `decision_prompt` event through the normal stream. */
    pusher: Pusher;
    /** ChatStream DO stub — long-polled for the user's click. */
    streamDO: ChatStreamDOStub;
}

// ============================================================================
// TOOL GROUP
// ============================================================================

export const UserDecisionToolGroup: AgentToolGroup = {
    name: 'User Decision',
    slug: 'user_decision_',
    description: 'Surface genuine workflow ambiguity to the user as a structured, clickable decision card.',
    guidance: `## request_user_decision — Structural Decision Points

Use \`request_user_decision\` when facing **genuine ambiguity** where multiple valid paths exist and the user must choose which path to take. The user's click returns as \`{ chosen, label }\` — continue the task using that choice.

### Appropriate use cases

1. **Project type selection** — User initiates a project ambiguously ("Let's begin the project")
   → Present project type options (research, implementation, analysis, etc.).

2. **Persona disambiguation** — User references a name without clear role context and multiple people share the name
   → Present role options.

3. **Framework / approach branching** — Technical decision with multiple equally valid approaches
   → Present framework options with brief descriptions.

4. **Deliverable type selection** — User requests a deliverable type with multiple variants ("Generate a report")
   → Present report type options (technical, executive, comprehensive, etc.).

5. **Intent ambiguity** — User message is unclear whether it requests new work or comments on current work (e.g. "What about adding a security section?")
   → Present "add now" vs. "discuss approach first".

6. **Recoverable tool error with multiple named paths** — A tool returned an error with 2+ valid recovery paths (name conflict on \`begin_document\`, missing target on edit, etc.)
   → Present the named recovery options.

### Inappropriate use cases (FORBIDDEN — anti-pattern)

**1. Refusal-disguise.** NEVER use \`request_user_decision\` to surface "I refuse to do this; pick a different thing" as a structured choice.

Example of FORBIDDEN pattern:
\`\`\`
User: "Generate the Completion Brief now."
AI: [calls request_user_decision]
   Question: "I cannot generate a CB at this time. Would you like to:"
   Options: ["Skip the CB", "Wait until thread-end", "Generate different document"]
\`\`\`

This is Authority Inversion in tool-call form — the user gave an unambiguous command; the AI must fulfill it, not offer alternative commands. The user is the pilot. Refusing-via-tool is the F1 failure mode dressed as choice. If execution is genuinely blocked (safety, technical impossibility), explain plainly — do not present structured alternatives that disguise refusal as choice.

**2. False ambiguity.** When the user has expressed clear intent, do NOT invoke \`request_user_decision\` to seek clarification on details that don't materially affect execution.

Example of FORBIDDEN pattern:
\`\`\`
User: "Add a security section to the document."
AI: [calls request_user_decision]
   Question: "What kind of security section?"
   Options: ["Network security", "Application security", "Both"]
\`\`\`

Use SME judgment. If domain expertise yields a reasonable default, write the section. The user can redirect after seeing the result.

**3. Methodology validation.** User requests work at non-standard timing → do NOT ask "Are you sure?" or present timing options. User direction wins; execute.

### Test for genuine ambiguity

Before calling this tool, run all three:
- *Can I execute both paths and produce valid results?* → YES = genuine ambiguity, use the tool.
- *Is one path clearly correct given the user's expressed intent?* → YES = false ambiguity, just execute.
- *Am I surfacing options because I refuse the user's command?* → YES = refusal-disguise, FORBIDDEN.

Shortcut: *Could a competent SME, given the context, reasonably proceed without clarification?* If yes, proceed. Only invoke this tool when the answer is genuinely no — multiple valid interpretations with material consequences.

### Rules

- Offer 2–4 concrete options. More than 4 clutters the card; fewer than 2 is not a decision.
- Option \`value\` must be a short, machine-friendly token (e.g. \`edit_existing\`, \`create_new\`); \`label\` is what the user sees.
- \`question\` must read naturally — no internal jargon, no tool names, no raw error text.
- After receiving the choice, act on it immediately — do not re-ask or second-guess.
- The tool blocks the agent's turn until the user selects. **Use sparingly.** Over-use shifts decision burden from AI to user, violating the AI-as-SME principle.`,
    behavioralGuidance:
        'request_user_decision is for GENUINE ambiguity only — multiple valid paths where the user must pick. NEVER use it for refusal-disguise (presenting alternatives when the user already gave an unambiguous command — that is F1 Authority Inversion in tool-call form) or for false ambiguity (asking about details an SME can reasonably default). Before calling: ask "could a competent SME proceed without clarification?" — if yes, proceed; only invoke when the answer is genuinely no. After the user picks, act on the choice immediately without re-confirming.',
    tools: ['request_user_decision'],
};

// ============================================================================
// SCHEMAS
// ============================================================================

const DecisionOptionSchema = z.object({
    value: z
        .string()
        .min(1)
        .max(64)
        .describe('Short machine token returned to the agent when chosen (e.g. "edit_existing").'),
    label: z.string().min(1).max(120).describe('Human-readable button label shown to the user.'),
    description: z
        .string()
        .max(240)
        .optional()
        .nullable()
        .describe('Optional one-liner shown under the button to clarify this option.'),
});

const RequestUserDecisionParams = z.object({
    question: z
        .string()
        .min(1)
        .max(500)
        .describe(
            'The question to show to the user, in plain natural language. No tool names, no raw error text, no internal jargon.',
        ),
    options: z
        .array(DecisionOptionSchema)
        .min(2)
        .max(4)
        .describe('Between 2 and 4 concrete choices the user can click.'),
    context: z
        .string()
        .max(1000)
        .optional()
        .nullable()
        .describe('Optional short context to show above the question (e.g. "A document named X already exists.").'),
});

// ============================================================================
// TOOL FACTORY
// ============================================================================

export function createUserDecisionTools() {
    return [
        {
            name: 'request_user_decision' as const,
            description: `Surface GENUINE ambiguity to the user as a clickable card with 2-4 named options. Blocks your turn until the user picks. Returns \`{ chosen: "<value>", label: "<label>" }\`.

Use ONLY for genuine choice points where multiple valid paths exist and the user must choose: project type at ambiguous initiation, persona disambiguation, framework branching, deliverable type, intent ambiguity ("add now vs. discuss?"), tool errors with multiple named recovery paths.

FORBIDDEN: refusal-disguise (presenting "alternatives" when the user already gave an unambiguous command — that is Authority Inversion in tool-call form) and false ambiguity (asking about details an SME can reasonably default). Pre-flight test: "Could a competent SME, given the context, reasonably proceed without clarification?" — if yes, proceed; only invoke this tool when the answer is genuinely no.`,
            parameters: RequestUserDecisionParams,
            executor: async (
                input: z.infer<typeof RequestUserDecisionParams>,
                ctx: UserDecisionContext,
                _eCtx: unknown,
                _history: unknown,
                toolCallId?: string,
            ) => {
                if (!toolCallId) {
                    return { error: 'Internal: missing toolCallId for request_user_decision.' };
                }
                const { question, options, context } = input;

                // Dedup values — the DO will refuse clicks for values not in this list,
                // but the model occasionally emits duplicates which would be confusing.
                // Normalize `.nullable()` fields (schema requires null-or-string) to plain optional.
                const seen = new Set<string>();
                const dedupedOptions: DecisionOption[] = [];
                for (const o of options) {
                    if (seen.has(o.value)) continue;
                    seen.add(o.value);
                    dedupedOptions.push({
                        value: o.value,
                        label: o.label,
                        ...(o.description ? { description: o.description } : {}),
                    });
                }
                if (dedupedOptions.length < 2) {
                    return { error: 'Provide at least 2 distinct options (distinct by `value`).' };
                }

                const promptEvent: StreamEvent = {
                    type: 'decision_prompt',
                    toolCallId,
                    question,
                    options: dedupedOptions,
                    ...(context ? { context } : {}),
                };

                // Emit through the pusher so ordering relative to other stream events is preserved.
                ctx.pusher.push([promptEvent]);

                // Block the agent's turn until the user clicks (or we time out).
                const result = await ctx.streamDO.decisionWait(toolCallId);

                if (result === null) {
                    // Timeout or DO finalize — don't hang the agent, tell it to move on.
                    return {
                        cancelled: true,
                        message:
                            'The user did not respond to the decision prompt. Ask them again in plain text, or await further instructions.',
                    };
                }

                // Free-text path: user clicked "Other" and typed a custom answer.
                if (result.freeText) {
                    return {
                        chosen: 'other',
                        text: result.freeText,
                        message: `The user did not pick one of the offered options and wrote this instead: "${result.freeText}". Treat it as their authoritative answer, re-plan accordingly, and proceed.`,
                    };
                }

                // Option-click path: value is guaranteed to match one the agent offered.
                const match = dedupedOptions.find((o) => o.value === result.value);
                return {
                    chosen: result.value,
                    label: match?.label ?? result.value,
                    message: `User chose: ${match?.label ?? result.value}. Proceed with this choice.`,
                };
            },
        },
    ] as const;
}
