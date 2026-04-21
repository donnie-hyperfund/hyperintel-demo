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
            description: `Emit the Next-Phase Initialization Blurb as a separate output.

This is a TERMINAL tool — calling it ends the summarization immediately.

Call this tool EXACTLY ONCE, AFTER you have finished writing the full summary as your text response.

The \`blurb\` parameter must contain the Next-Phase Initialization Blurb from Section 13 of the approved Completion Brief, copied verbatim. Do NOT include any header, intro phrase, or commentary — only the raw blurb content that should be used to initialize the next phase.`,
            parameters: GenerateBlurbParams,
        },
    ] as const;
}
