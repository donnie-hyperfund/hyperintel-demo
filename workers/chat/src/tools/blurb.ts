/**
 * Blurb Tool
 *
 * Terminal tool used by the phase-transition agent to emit the Next-Phase
 * Initialization Blurb extracted from the approved Completion Brief.
 *
 * Terminal tool — no executor. Calling it ends the transition run.
 * The blurb content is read from the tool's input (captured via the `done`
 * event with outputTool='generate_blurb'). The transition flow then persists
 * it as the first user-role message in the new phase chat.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { z } from 'zod';

export const BlurbToolGroup: AgentToolGroup = {
    name: 'Blurb',
    slug: 'blurb_',
    description: 'Tool for emitting the Next-Phase Initialization Blurb for the next phase.',
    tools: ['generate_blurb'],
};

const GenerateBlurbParams = z.object({
    blurb: z
        .string()
        .min(1)
        .describe(
            'The Next-Phase Initialization Blurb verbatim — the prompt that will open the next phase. Copy it exactly from Section 13 of the approved Completion Brief, without any surrounding commentary, headers, or prefixes.',
        ),
});

export function createBlurbTools() {
    return [
        {
            name: 'generate_blurb' as const,
            description: `REQUIRED TERMINAL ACTION — emits the Next-Phase Initialization Blurb that seeds the next phase chat.

You MUST call this tool EXACTLY ONCE. Do not write normal assistant text before or after this call. Failing to call it leaves the next phase with no initiation prompt and stalls the project.

The \`blurb\` parameter is the next-phase initialization prompt from the approved Completion Brief. Prefer the verbatim content from the code block inside the "NEXT-PHASE INITIALIZATION BLURB" section when present. If the format differs, infer the intended next-phase seed prompt and pass only that prompt — no header, no fences, no commentary.`,
            parameters: GenerateBlurbParams,
        },
    ] as const;
}
