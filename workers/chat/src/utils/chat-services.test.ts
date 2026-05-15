import { describe, expect, it, vi } from 'vitest';
import { callChatServicesSystemAction } from './chat-services';

function makeCtx(systemAction = vi.fn(async () => undefined)) {
    const writeDataPoint = vi.fn();
    const env = {
        CHAT_SERVICES: { systemAction },
        STREAM_AE: { writeDataPoint },
        WORKER_NAME: 'hi-chat',
        WORKER_NAME_FULL: 'hi-chat-dev',
    } as unknown as ChatEnv;

    return { ctx: { env }, systemAction, writeDataPoint };
}

describe('callChatServicesSystemAction', () => {
    it('calls ChatServices and emits registerStream timing keyed by agentMessageId', async () => {
        const { ctx, systemAction, writeDataPoint } = makeCtx();

        await callChatServicesSystemAction(ctx, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            previewAlias: 'branch-a',
            agentMessageId: 'agent-1',
            userMessageId: 'user-msg-1',
        });

        expect(systemAction).toHaveBeenCalledWith({
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            previewAlias: 'branch-a',
            agentMessageId: 'agent-1',
            userMessageId: 'user-msg-1',
        });
        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['agent-1'],
                blobs: [
                    'services_register_stream_rpc',
                    'dev',
                    'hi-chat',
                    'chat-1',
                    'branch-a',
                    'registerStream',
                    'chat',
                ],
                doubles: [expect.any(Number), 1, expect.any(Number)],
            }),
        );
    });

    it('emits failure timing and rethrows', async () => {
        const error = new Error('services down');
        const { ctx, writeDataPoint } = makeCtx(
            vi.fn(async () => {
                throw error;
            }),
        );

        await expect(
            callChatServicesSystemAction(ctx, {
                action: 'messageCreated',
                prefix: 'intake',
                identifier: 'intake-1',
                userId: 'user-1',
                message: { id: 'msg-1' },
            }),
        ).rejects.toThrow(error);

        expect(writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['intake-1'],
                blobs: ['services_message_created_rpc', 'dev', 'hi-chat', 'intake-1', '', 'messageCreated', 'intake'],
                doubles: [expect.any(Number), 0, expect.any(Number)],
            }),
        );
    });
});
