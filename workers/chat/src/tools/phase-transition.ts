/**
 * Phase Transition Tools
 *
 * Terminal tool for ending the current phase and triggering summarization.
 * Terminal tools have NO executor — the agent runner emits a `done` event
 * with `outputType: 'tool'` and `outputTool: 'generate_summary'`,
 * which the frontend uses to trigger the summarize endpoint.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { z } from 'zod';

export const PhaseTransitionToolGroup: AgentToolGroup = {
    name: 'Phase Transition',
    slug: 'phase_',
    description: 'Tool for completing the current phase and transitioning to the next.',
    guidance: `## When to Use
\`generate_summary\` is a **terminal tool** — calling it ends the current conversation turn immediately.

Call it ONLY when the user clearly signals they want to **end the current phase** and move on.

### Trigger signals (call generate_summary)
- "let's move to the next phase"
- "this phase is done / complete"
- "wrap up" / "wrap this up"
- "create the completion summary"
- "summarize and move on"
- "we're done here, next phase"
- Any clear intent to **transition** or **conclude** the current phase

### NOT trigger signals (do NOT call generate_summary)
- Asking for a summary of the conversation so far (informational, not transitional)
- Creating or editing documents (use document tools)
- Asking questions about the work done
- Vague statements like "looks good" or "nice work" (these may be approvals, not phase transitions)
- Any request that implies continued work in the current phase

### When in doubt
If the user's intent is ambiguous — e.g., "can you summarize this?" could mean "give me a recap" vs "create the completion brief and move on" — **ask for clarification** before calling this tool.`,
    behavioralGuidance:
        'NEVER call generate_summary unless the user explicitly signals intent to end the current phase and move to the next. When ambiguous, ask for clarification instead of calling the tool.',
    tools: ['generate_summary'],
};

const GenerateSummaryParams = z.object({
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
            name: 'generate_summary' as const,
            description: `End the current phase and generate a Completion Brief.

This is a TERMINAL tool — calling it immediately ends the conversation turn.
The system will automatically create a Completion Brief document summarizing this phase's work and transition to the next phase.

ONLY call this when the user explicitly wants to move to the next phase.
Do NOT call this for general summaries or recaps — those should be written as regular text responses.`,
            parameters: GenerateSummaryParams,
        },
    ] as const;
}
