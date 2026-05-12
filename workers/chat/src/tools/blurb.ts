/**
 * Blurb Tool
 *
 * Terminal tool used by the summarizer agent to emit the Next-Phase
 * Initialization Blurb as a separate output from the summary text.
 *
 * Terminal tool — no executor. Calling it ends the summarizer run.
 * The blurb content is read from the tool's input (captured via the `done`
 * event with outputTool='generate_blurb'). The summarizer then persists it
 * as a user-role message in the new phase chat.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import { z } from 'zod';

export const BlurbToolGroup: AgentToolGroup = {
    name: 'Blurb',
    slug: 'blurb_',
    description: 'Tool for emitting the Next-Phase Initialization Blurb as a separate output.',
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

You MUST call this tool EXACTLY ONCE at the end of every summarization run, AFTER writing the summary text. Failing to call it leaves the next phase with no initiation prompt and stalls the project.

The \`blurb\` parameter is the VERBATIM content from the code block inside the "NEXT-PHASE INITIALIZATION BLURB" section of the approved Completion Brief — no header, no fences, no commentary, no rephrasing. Copy it character-for-character.`,
            parameters: GenerateBlurbParams,
        },
    ] as const;
}
