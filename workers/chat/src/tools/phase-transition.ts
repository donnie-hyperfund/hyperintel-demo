/**
 * Phase Transition Tools
 *
 * Terminal tool for ending the current phase and starting the transition flow.
 * Terminal tools have NO executor — the agent runner emits a `done` event
 * with `outputType: 'tool'` and `outputTool: 'start_phase_transition'`,
 * which the frontend uses to trigger the phase-transition endpoint.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { z } from 'zod';

export const PhaseTransitionToolGroup: AgentToolGroup = {
    name: 'Phase Transition',
    slug: 'phase_',
    description: 'Tool for completing the current phase and transitioning to the next.',
    guidance: `## When to Use
\`start_phase_transition\` is a **terminal tool** — calling it ends the current conversation turn immediately.

Call it ONLY when the user clearly signals they want to **end the current phase** and move on.

### Trigger signals (call start_phase_transition)
- "let's move to the next phase"
- "this phase is done / complete"
- "wrap up" / "wrap this up"
- "create the completion summary"
- "summarize and move on"
- "we're done here, next phase"
- Any clear intent to **transition** or **conclude** the current phase

### NOT trigger signals (do NOT call start_phase_transition)
- Asking for a summary of the conversation so far (informational, not transitional)
- Creating or editing documents (use document tools)
- Asking questions about the work done
- Vague statements like "looks good" or "nice work" (these may be approvals, not phase transitions)
- Any request that implies continued work in the current phase

### When in doubt
If the user's intent is ambiguous — e.g., "can you summarize this?" could mean "give me a recap" vs "create the completion brief and move on" — **ask for clarification** before calling this tool.`,
    behavioralGuidance:
        'NEVER call start_phase_transition unless the user explicitly signals intent to end the current phase and move to the next. When ambiguous, ask for clarification instead of calling the tool.',
    tools: ['start_phase_transition'],
};

const StartPhaseTransitionParams = z.object({
    reason: z
        .string()
        .min(1)
        .describe(
            'Brief explanation of why the phase is being completed (e.g., "User confirmed all deliverables are ready and wants to proceed to the next phase").',
        ),
});

export function createPhaseTransitionTools() {
    return [
        {
            name: 'start_phase_transition' as const,
            description: `End the current phase and transition to the next one.

This is a TERMINAL tool — calling it immediately ends the conversation turn.
The system will create the next phase chat from the approved Completion Brief.

IMPORTANT: A Completion Brief must be generated and approved BEFORE calling this tool.
If no approved Completion Brief exists, do NOT call this tool — instead, ask the user if they want to generate one first (using the completion_brief tool).

ONLY call this when the user explicitly wants to move to the next phase.
Do NOT call this for general summaries or recaps — those should be written as regular text responses.`,
            parameters: StartPhaseTransitionParams,
        },
    ] as const;
}
