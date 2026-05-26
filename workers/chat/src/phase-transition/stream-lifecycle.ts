import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import type { Ctx } from '../context';
import type { UserGatewayStub } from '../utils/do-stubs';
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
    ugStub: UserGatewayStub;
    infra: PhaseTransitionInfra;
}): Promise<false> {
    const { ctx, chat, chatId, ugStub, infra } = opts;
    chat.active_agent_message_id = null;
    await ctx.em!.flush();

    const cancellationError = new Error('Phase transition cancelled');
    await cleanupStreamDO({
        pusher: infra.pusher,
        streamDO: infra.streamDO,
        ugStub,
        topic: `chat:${chatId}`,
        error: cancellationError,
        errorMetadata: buildStoredErrorMetadata({
            classification: classifyWorkerError(cancellationError),
            requestId: ctx.requestId,
        }),
    });
    return false;
}

export async function deliverSourceTransitionDone(opts: {
    chatId: string;
    newChatId: string;
    ugStub: UserGatewayStub;
    infra: PhaseTransitionInfra;
}): Promise<boolean> {
    const { chatId, newChatId, ugStub, infra } = opts;
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
            ugStub,
            topic: `chat:${chatId}`,
            label: 'phase-transition',
        });
        return false;
    }

    await finalizeStream(infra.streamDO, ugStub, `chat:${chatId}`);
    return true;
}

export async function handlePhaseTransitionFailure(opts: {
    ctx: Ctx;
    chat: ChatEntity;
    chatId: string;
    agentMessageId: string;
    ugStub: UserGatewayStub;
    infra: PhaseTransitionInfra;
    error: unknown;
}): Promise<false> {
    const { ctx, chat, chatId, agentMessageId, ugStub, infra, error } = opts;
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
        ugStub,
        topic: `chat:${chatId}`,
        error,
        errorMetadata,
    });

    return false;
}
