import { MockDurableObjectId, MockDurableObjectState } from '@common/common/local.do-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTopicHandler } from './chat-topic-handler';
import { IntakeTopicHandler } from './intake-topic-handler';

function createStorage(): DurableObjectStorage {
    return new MockDurableObjectState(new MockDurableObjectId('ug-1')).storage as unknown as DurableObjectStorage;
}

function createEnv(
    getTopicSubscribeInfo = vi.fn(),
    streamSubscribe = vi.fn(),
    clearActiveStream = vi.fn(),
): ObjectsEnv {
    return {
        CHAT_SERVICES: {
            getTopicSubscribeInfo,
            clearActiveStream,
        },
        STREAM_AE: {
            writeDataPoint: vi.fn(),
        },
        CHAT_STREAM_DO: {
            idFromName: (name: string) => ({ name }),
            get: () => ({
                subscribe: streamSubscribe,
            }),
        },
    } as unknown as ObjectsEnv;
}

describe('StreamTopicHandler services policy client', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('checks chat subscribe permission through CHAT_SERVICES', async () => {
        const getTopicSubscribeInfo = vi.fn(async () => ({ allowed: true }));
        const env = createEnv(getTopicSubscribeInfo);
        const handler = new ChatTopicHandler(createStorage());
        handler.previewAlias = 'branch-a';

        await expect(handler.canSubscribe('user-1', 'chat-1', env)).resolves.toEqual({
            allowed: true,
            subscribeInfo: { allowed: true },
        });

        expect(getTopicSubscribeInfo).toHaveBeenCalledWith({
            userId: 'user-1',
            topic: 'chat:chat-1',
            prefix: 'chat',
            identifier: 'chat-1',
            previewAlias: 'branch-a',
        });
        expect(env.STREAM_AE.writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['chat-1'],
                blobs: ['services_permission_rpc', 'unknown', 'unknown', 'chat-1', 'branch-a', '', 'chat'],
                doubles: expect.arrayContaining([1, 1]),
            }),
        );
    });

    it('uses the chat subscribe-info preflight for metadata without a second services call', async () => {
        const getTopicSubscribeInfo = vi.fn(async () => ({
            allowed: true,
            selectedModel: 'gpt-5.4',
            completionBriefStatus: null,
        }));
        const env = createEnv(getTopicSubscribeInfo);
        const handler = new ChatTopicHandler(createStorage());

        const decision = await handler.canSubscribe('user-1', 'chat-1', env);
        expect(decision).toEqual({
            allowed: true,
            subscribeInfo: {
                allowed: true,
                selectedModel: 'gpt-5.4',
                completionBriefStatus: null,
            },
        });
        if (!decision.allowed) throw new Error('expected allowed decision');

        await expect(handler.subscribe('user-1', 'chat-1', env, decision)).resolves.toEqual({
            status: 'idle',
            selectedModel: 'gpt-5.4',
            completionBriefStatus: null,
        });
        expect(getTopicSubscribeInfo).toHaveBeenCalledTimes(1);
    });

    it('merges chat metadata and streamType into streaming subscribe responses', async () => {
        const getTopicSubscribeInfo = vi.fn(async () => ({
            allowed: true,
            activeAgentMessageId: 'agent-1',
            selectedModel: 'gpt-5.4',
            completionBriefStatus: 'pending',
        }));
        const streamSubscribe = vi.fn(async () => ({
            snapshot: { status: 'streaming', events: [{ type: 'delta', text: 'hi' }] },
            seqHigh: 7,
            streamType: 'summary',
        }));
        const env = createEnv(getTopicSubscribeInfo, streamSubscribe);
        const handler = new ChatTopicHandler(createStorage());

        const decision = await handler.canSubscribe('user-1', 'chat-1', env);
        if (!decision.allowed) throw new Error('expected allowed decision');

        await expect(handler.subscribe('user-1', 'chat-1', env, decision)).resolves.toEqual({
            status: 'streaming',
            agentMessageId: 'agent-1',
            snapshot: { status: 'streaming', events: [{ type: 'delta', text: 'hi' }] },
            seqHigh: 7,
            streamType: 'summary',
            selectedModel: 'gpt-5.4',
            completionBriefStatus: 'pending',
        });
        expect(getTopicSubscribeInfo).toHaveBeenCalledTimes(1);
        expect(streamSubscribe).toHaveBeenCalledWith('user-1', 'user-1');
    });

    it('clears stale active stream through CHAT_SERVICES when the stream is terminal', async () => {
        const getTopicSubscribeInfo = vi.fn(async () => ({ allowed: true, activeAgentMessageId: 'agent-1' }));
        const streamSubscribe = vi.fn(async () => ({
            snapshot: { status: 'done', events: [] },
            seqHigh: 3,
        }));
        const clearActiveStream = vi.fn(async () => {});
        const env = createEnv(getTopicSubscribeInfo, streamSubscribe, clearActiveStream);
        const handler = new ChatTopicHandler(createStorage());
        handler.previewAlias = 'branch-a';

        const decision = await handler.canSubscribe('user-1', 'chat-1', env);
        if (!decision.allowed) throw new Error('expected allowed decision');

        await expect(handler.subscribe('user-1', 'chat-1', env, decision)).resolves.toEqual({
            status: 'idle',
            selectedModel: null,
            completionBriefStatus: null,
        });
        expect(clearActiveStream).toHaveBeenCalledWith({
            topic: 'chat:chat-1',
            prefix: 'chat',
            identifier: 'chat-1',
            agentMessageId: 'agent-1',
            previewAlias: 'branch-a',
        });
        expect(env.STREAM_AE.writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['agent-1'],
                blobs: ['services_stale_cleanup_rpc', 'unknown', 'unknown', 'chat-1', 'branch-a', 'agent-1', 'chat'],
                doubles: expect.arrayContaining([1]),
            }),
        );
    });

    it('logs stale cleanup service failures and still returns idle', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const getTopicSubscribeInfo = vi.fn(async () => ({ allowed: true, activeAgentMessageId: 'agent-1' }));
        const streamSubscribe = vi.fn(async () => {
            throw new Error('stream gone');
        });
        const clearActiveStream = vi.fn(async () => {
            throw new Error('db unavailable');
        });
        const env = createEnv(getTopicSubscribeInfo, streamSubscribe, clearActiveStream);
        const handler = new ChatTopicHandler(createStorage());

        const decision = await handler.canSubscribe('user-1', 'chat-1', env);
        if (!decision.allowed) throw new Error('expected allowed decision');

        await expect(handler.subscribe('user-1', 'chat-1', env, decision)).resolves.toEqual({
            status: 'idle',
            selectedModel: null,
            completionBriefStatus: null,
        });
        expect(consoleError).toHaveBeenCalledWith(
            'ChatTopicHandler: failed to clear activeAgentMessageId',
            expect.any(Error),
        );
        expect(env.STREAM_AE.writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['agent-1'],
                blobs: ['services_stale_cleanup_rpc', 'unknown', 'unknown', 'chat-1', '', 'agent-1', 'chat'],
                doubles: expect.arrayContaining([0]),
            }),
        );
    });

    it('returns stale without clearing active stream when state DO snapshot fails', async () => {
        const getTopicSubscribeInfo = vi.fn(async () => ({
            allowed: true,
            activeAgentMessageId: 'agent-1',
            selectedModel: 'gpt-5.4',
            completionBriefStatus: null,
        }));
        const streamSubscribe = vi.fn(async () => ({ stale: true as const, seqHigh: -1 }));
        const clearActiveStream = vi.fn(async () => {});
        const env = createEnv(getTopicSubscribeInfo, streamSubscribe, clearActiveStream);
        const handler = new ChatTopicHandler(createStorage());

        const decision = await handler.canSubscribe('user-1', 'chat-1', env);
        if (!decision.allowed) throw new Error('expected allowed decision');

        await expect(handler.subscribe('user-1', 'chat-1', env, decision)).resolves.toEqual({
            status: 'stale',
            selectedModel: 'gpt-5.4',
            completionBriefStatus: null,
        });
        expect(clearActiveStream).not.toHaveBeenCalled();
    });

    it('forwards replayStatus from ChatStreamDO into streaming response', async () => {
        const getTopicSubscribeInfo = vi.fn(async () => ({
            allowed: true,
            activeAgentMessageId: 'agent-1',
        }));
        const streamSubscribe = vi.fn(async () => ({
            snapshot: { status: 'streaming', blocks: [] },
            seqHigh: 5,
            replayStatus: 'failed',
        }));
        const env = createEnv(getTopicSubscribeInfo, streamSubscribe);
        const handler = new ChatTopicHandler(createStorage());

        const decision = await handler.canSubscribe('user-1', 'chat-1', env);
        if (!decision.allowed) throw new Error('expected allowed decision');

        const result = await handler.subscribe('user-1', 'chat-1', env, decision);
        expect(result).toMatchObject({
            status: 'streaming',
            replayStatus: 'failed',
        });
    });

    it('checks intake subscribe permission through CHAT_SERVICES', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const getTopicSubscribeInfo = vi.fn(async () => ({ allowed: false }));
        const env = createEnv(getTopicSubscribeInfo);
        const handler = new IntakeTopicHandler(createStorage());

        await expect(handler.canSubscribe('user-1', 'chat-1', env)).resolves.toEqual({ allowed: false });

        expect(getTopicSubscribeInfo).toHaveBeenCalledWith({
            userId: 'user-1',
            topic: 'intake:chat-1',
            prefix: 'intake',
            identifier: 'chat-1',
            previewAlias: undefined,
        });
    });

    it('fails closed when CHAT_SERVICES throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const getTopicSubscribeInfo = vi.fn(async () => {
            throw new Error('services down');
        });
        const env = createEnv(getTopicSubscribeInfo);
        const handler = new ChatTopicHandler(createStorage());

        await expect(handler.canSubscribe('user-1', 'chat-1', env)).resolves.toEqual({ allowed: false });
        expect(env.STREAM_AE.writeDataPoint).toHaveBeenCalledWith(
            expect.objectContaining({
                indexes: ['chat-1'],
                blobs: ['services_permission_rpc', 'unknown', 'unknown', 'chat-1', '', '', 'chat'],
                doubles: expect.arrayContaining([0]),
            }),
        );
    });
});
