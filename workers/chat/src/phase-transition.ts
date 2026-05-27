import type { StreamEvent } from '@/lib/schema/stream';
import { extractNextPhaseBlurb } from './phase-transition/blurb-extraction';
import {
    broadcastNextPhaseCreated,
    createNextPhaseChat,
    nameSourcePhaseIfMissing,
} from './phase-transition/chat-lifecycle';
import { preparePhaseTransitionPromptInput } from './phase-transition/prompt-input';
import {
    cancelPhaseTransition,
    deliverSourceTransitionDone,
    handlePhaseTransitionFailure,
} from './phase-transition/stream-lifecycle';
import type { PhaseTransitionContext, PhaseTransitionResult } from './phase-transition/types';
import { setupStreamInfra } from './utils/stream-runner';

export type { PhaseTransitionOptions } from './phase-transition/types';
export { PENDING_PHASE_MESSAGE_METADATA_KEY, PHASE_TRANSITION_STREAM_TYPE } from './phase-transition/types';

export async function runPhaseTransition(context: PhaseTransitionContext): Promise<PhaseTransitionResult> {
    const { data, ctx, options, chat, agentMessageId, ugStub } = context;
    const { chatId } = data;
    const infra = setupStreamInfra(agentMessageId, ctx, 'phase-transition');

    try {
        if (!ctx.anthropic) {
            throw new Error('Anthropic client required');
        }

        const promptInput = await preparePhaseTransitionPromptInput({ ctx, chat, chatId });
        const extraction = await extractNextPhaseBlurb({ input: promptInput, ctx, chat, options, infra });

        if (extraction.wasAborted || infra.abortController.signal.aborted) {
            return cancelPhaseTransition({ ctx, chat, chatId, ugStub, infra });
        }

        infra.pusher.push([{ type: 'status_update', status: 'finalizing' } as StreamEvent]);

        if (extraction.ignoredTextContent.trim().length > 0) {
            console.warn(
                `[phase-transition] ignored unexpected text emitted during blurb extraction (chat=${chatId}, chars=${extraction.ignoredTextContent.trim().length})`,
            );
        }

        if (!extraction.blurbContent) {
            throw new Error('No next-phase initialization prompt emitted by generate_blurb');
        }

        const newChat = await createNextPhaseChat({
            ctx,
            chat,
            sourceChatId: chatId,
            documents: promptInput.documents,
            blurbContent: extraction.blurbContent,
        });
        await nameSourcePhaseIfMissing({
            ctx,
            chat,
            documents: promptInput.documents,
            completionBriefContent: promptInput.completionBriefContent,
            blurbContent: extraction.blurbContent,
        });
        broadcastNextPhaseCreated({ ugStub, newChat, projectId: chat.project!.id });

        const doneDelivered = await deliverSourceTransitionDone({
            chatId,
            newChatId: newChat.id,
            ugStub,
            infra,
        });
        if (!doneDelivered) return false;

        return true;
    } catch (error) {
        return handlePhaseTransitionFailure({ ctx, chat, chatId, agentMessageId, ugStub, infra, error });
    }
}
