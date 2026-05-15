import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { Ctx } from '../context';
import {
    buildStoredErrorMetadata,
    buildWorkerErrorLogContext,
    classifyWorkerError,
    logWorkerError,
} from '../utils/error-metadata';
import { finalizeStream, finalizeStreamWithoutDone } from '../utils/stream-runner';
import { cleanupStreamDO, pushStreamEventsWithRetry } from '../utils/stream-utils';
import type { PhaseTransitionInfra } from './types';

export async function cancelPhaseTransition(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    chatId: string;
    infra: PhaseTransitionInfra;
}): Promise<false> {
    const { ctx, chat, chatId, infra } = opts;
    chat.active_agent_message_id = null;
    await ctx.em!.flush();

    const cancellationError = new Error('Phase transition cancelled');
    await cleanupStreamDO({
        pusher: infra.pusher,
        streamDO: infra.streamDO,
        error: cancellationError,
        errorMetadata: buildStoredErrorMetadata({
            classification: classifyWorkerError(cancellationError),
            requestId: ctx.requestId,
        }),
    });
    return false;
}

export async function deliverSourceTransitionDone(opts: {
    newChatId: string;
    infra: PhaseTransitionInfra;
}): Promise<boolean> {
    const { newChatId, infra } = opts;
    await infra.pusher.waitAll();
    const terminalDoneDelivered = await pushStreamEventsWithRetry({
        streamDO: infra.streamDO,
        events: [{ type: 'done', newChatId }],
        seq: infra.pusher.seq,
        label: 'phase-transition',
    });
    if (!terminalDoneDelivered) {
        console.error('[phase-transition] terminal done delivery failed; skipping stream_status:done');
        await finalizeStreamWithoutDone({
            streamDO: infra.streamDO,
            label: 'phase-transition',
        });
        return false;
    }

    await finalizeStream(infra.streamDO);
    return true;
}

export async function handlePhaseTransitionFailure(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    chatId: string;
    agentMessageId: string;
    infra: PhaseTransitionInfra;
    error: unknown;
}): Promise<false> {
    const { ctx, chat, chatId, agentMessageId, infra, error } = opts;
    const classification = classifyWorkerError(error);
    const errorMetadata = buildStoredErrorMetadata({ classification, requestId: ctx.requestId });
    logWorkerError(
        'phase-transition',
        buildWorkerErrorLogContext({
            classification,
            stage: 'catch',
            chatId,
            agentMessageId,
            requestId: ctx.requestId,
            error,
        }),
        error,
    );

    try {
        chat.active_agent_message_id = null;
        await ctx.em!.flush();
    } catch (saveError) {
        logWorkerError(
            'phase-transition',
            buildWorkerErrorLogContext({
                classification: classifyWorkerError(saveError),
                stage: 'clear_active_agent_message_id',
                chatId,
                agentMessageId,
                requestId: ctx.requestId,
                error: saveError,
            }),
            saveError,
        );
    }

    await cleanupStreamDO({
        pusher: infra.pusher,
        streamDO: infra.streamDO,
        error,
        errorMetadata,
    });

    return false;
}
