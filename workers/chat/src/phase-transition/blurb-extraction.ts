import { runAgentStream } from '@common/ai/agent';
import type { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { StreamEvent } from '@/lib/schema/stream';
import type { Ctx } from '../context';
import { BlurbToolGroup, createBlurbTools } from '../tools/blurb';
import { createDocumentTools } from '../tools/documents';
import { createKnowledgeTools } from '../tools/knowledge-search';
import { createWebScrapeTools } from '../tools/web-scrape';
import { preprocessContext } from '../utils/preprocess-context';
import { runStreamLoop } from '../utils/stream-runner';
import { BLURB_TOOL_NAME } from './contract';
import { getPhaseTransitionInferenceParams, type PhaseTransitionPromptInput } from './prompt-input';
import type { PhaseTransitionInfra, PhaseTransitionOptions } from './types';

export type BlurbExtractionResult = {
    blurbContent: string | null;
    ignoredTextContent: string;
    wasAborted: boolean;
};

export async function extractNextPhaseBlurb(opts: {
    input: PhaseTransitionPromptInput;
    ctx: Ctx;
    chat: ChatEntity;
    options: PhaseTransitionOptions;
    infra: PhaseTransitionInfra;
}): Promise<BlurbExtractionResult> {
    const { input, ctx, chat, options, infra } = opts;
    const blurbTools = createBlurbTools();
    const collapseToolRegistry = [...createDocumentTools(), ...createKnowledgeTools(), ...createWebScrapeTools()];
    const inferenceParams =
        options.overrideInference ?? getPhaseTransitionInferenceParams(input.estimatedContextTokens);
    const { stream, historyPromise } = runAgentStream(
        {},
        ctx,
        {
            ...inferenceParams,
            cacheId: chat.id,
            instructions: input.instructions,
            context: input.transitionMessages,
            countReasoningAsContent: true,
            contentThreshold: 5,
        },
        blurbTools,
        {
            terminalToolNames: [BLURB_TOOL_NAME],
            toolGroups: [BlurbToolGroup],
            config: {
                preprocessContext,
                autoContinue: { enabled: true, maxContinuations: 3, nudgeOnEmpty: true },
                collapseToolRegistry,
                abortSignal: infra.abortController.signal,
            },
        },
    );

    const result: BlurbExtractionResult = {
        blurbContent: null,
        ignoredTextContent: '',
        wasAborted: false,
    };

    infra.pusher.push([{ type: 'status_update', status: 'preparing-next-phase' } as StreamEvent]);

    await runStreamLoop({
        stream,
        push: (events) => {
            infra.pusher.push(
                events.filter(
                    (event) =>
                        event.type !== 'delta' &&
                        event.type !== 'reasoning_start' &&
                        event.type !== 'reasoning_delta' &&
                        event.type !== 'reasoning_done',
                ),
            );
        },
        docEventsCtx: { em: ctx.em!, projectId: chat.project!.id },
        onSpecificEvent: (event) => {
            if (event.type === 'done_ext') {
                result.ignoredTextContent = event.streamLog.fullContent ?? '';
                result.wasAborted = event.aborted ?? false;
            } else if (event.type === 'done' && event.outputType === 'tool' && event.outputTool === BLURB_TOOL_NAME) {
                const finalOutput = event.finalOutput as { blurb?: unknown } | undefined;
                if (finalOutput && typeof finalOutput.blurb === 'string' && finalOutput.blurb.trim().length > 0) {
                    result.blurbContent = finalOutput.blurb.trim();
                }
            }
        },
    });

    await historyPromise;
    return result;
}
