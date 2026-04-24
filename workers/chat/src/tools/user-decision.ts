/**
 * User Decision Tools
 *
 * `request_user_decision` surfaces a structured choice to the user as a clickable
 * card above the chat composer, then blocks the agent's turn until the user picks
 * one of the offered options. Replaces the previous "ask the user in plain text"
 * approach with a hard-structural contract — the model actually waits on
 * `tool_result`, and the value it receives is guaranteed to be one the agent
 * itself offered (validated server-side in the DO).
 *
 * Use for: name conflicts, missing resources, ambiguous intent, any branch where
 * multiple valid paths exist and the user should be the one to pick.
 *
 * Do NOT use for: confirmations of a decision the user already stated (just do it),
 * anything that can be inferred with confidence, yes/no questions phrased as chat.
 */

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
    slug: 'decision_',
    description: 'Ask the user to pick from a small set of concrete options via a clickable UI card.',
    guidance: `## When to Use
Call \`request_user_decision\` whenever multiple valid paths exist and the user should decide which one to take. This includes, but is not limited to:
- A document tool returned a conflict (name already exists, not found, wrong status, mode mismatch)
- The user's request is ambiguous between two concrete interpretations you can name
- You need to pick between two resources/versions/approaches and there is no obviously correct choice
- A recoverable error has more than one reasonable next step

The user's click is returned to you as \`{ chosen: "<value>", label: "<label>" }\` — continue the task using that choice.

## When NOT to Use
- For free-text questions ("what should this doc say about X?") — just ask in chat.
- For things you can figure out from context with high confidence — just do it.
- After a \`<system>\` approval/rejection event — that decision was already made.

## Rules
- Offer 2–4 concrete options. More than 4 clutters the card; fewer than 2 is not a decision.
- Option \`value\`s must be short, machine-friendly tokens (e.g. \`edit_existing\`, \`create_new\`). The \`label\` is what the user sees.
- \`question\` must read naturally to the user — no internal jargon, no tool names, no error message echoes.
- NEVER call this tool twice in a row without acting on the first decision.
- After receiving the user's choice, proceed with that path — do not re-ask or second-guess.`,
    behavioralGuidance:
        'Prefer request_user_decision over asking the user in plain text when a tool returned a recoverable error with multiple named paths (name conflict, not found, wrong status), or when intent is ambiguous between 2-4 concrete options. After receiving the choice, act on it immediately — do not re-confirm.',
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
            description: `Ask the user to pick one of a small set of concrete options via a clickable card above the chat composer.

Blocks your turn until the user selects an option. Returns \`{ chosen: "<value>", label: "<label>" }\`.

Use this INSTEAD of asking a multiple-choice question in chat text, so the user's intent is captured unambiguously. Only call when 2-4 concrete paths exist and the user should pick.`,
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
