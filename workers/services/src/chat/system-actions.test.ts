import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerMsg } from '@/lib/schema/ws-protocol';
import { handleSystemAction } from './system-actions';
import { ChatServices } from '../index';

// ============================================================================
// MOCK HARNESS
// ============================================================================
//
// handleSystemAction calls:
//   env.USER_GATEWAY.get(idFromName(ugName)).broadcastToTopic(topic, msg)
//   env.CHAT_STREAM_DO.get(idFromName(amid)).init(...)
//   env.CHAT_STREAM_DO.get(idFromName(amid)).subscribe(userId, ugName)
//
// Build a fake `env` that records:
//   - idFromName arguments (for verifying DO routing/previewAlias)
//   - method calls on each stub (with args)
//   - global call order (for ordering assertions: init -> subscribe -> broadcast)
// ============================================================================

interface RecordedCall {
    kind: 'init' | 'subscribe' | 'broadcastToTopic';
    args: unknown[];
}

function makeEnv() {
    const callLog: RecordedCall[] = [];

    const ugStub = {
        broadcastToTopic: vi.fn(async (topic: string, message: unknown) => {
            callLog.push({ kind: 'broadcastToTopic', args: [topic, message] });
        }),
    };
    const streamStub = {
        init: vi.fn(async (...args: unknown[]) => {
            callLog.push({ kind: 'init', args });
        }),
        subscribe: vi.fn(async (...args: unknown[]) => {
            callLog.push({ kind: 'subscribe', args });
        }),
    };

    const ugIdFromName = vi.fn((name: string) => ({ __ug: name }));
    const streamIdFromName = vi.fn((name: string) => ({ __stream: name }));

    const env = {
        USER_GATEWAY: {
            idFromName: ugIdFromName,
            get: vi.fn(() => ugStub),
        },
        CHAT_STREAM_DO: {
            idFromName: streamIdFromName,
            get: vi.fn(() => streamStub),
        },
    } as unknown as ServicesEnv;

    return { env, callLog, ugStub, streamStub, ugIdFromName, streamIdFromName };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// REGISTER STREAM
// ============================================================================

describe('handleSystemAction registerStream', () => {
    it('calls ChatStreamDO.init then subscribe then UG.broadcastToTopic in that order', async () => {
        const { env, callLog } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            userMessageId: 'umsg-1',
        });

        expect(callLog.map((c) => c.kind)).toEqual(['init', 'subscribe', 'broadcastToTopic']);
    });

    it('broadcasts a stream_started message tagged with the topic', async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            userMessageId: 'umsg-1',
        });

        expect(ugStub.broadcastToTopic).toHaveBeenCalledTimes(1);
        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('chat:chat-1', {
            topic: 'chat:chat-1',
            type: ServerMsg.StreamStarted,
            agentMessageId: 'agent-1',
            userMessageId: 'umsg-1',
        });
    });

    it('includes streamType in the broadcast when it is summary', async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            streamType: 'summary',
        });

        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('chat:chat-1', {
            topic: 'chat:chat-1',
            type: ServerMsg.StreamStarted,
            agentMessageId: 'agent-1',
            streamType: 'summary',
        });
    });

    it("omits streamType in the broadcast when it is the default 'chat'", async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            streamType: 'chat',
        });

        const sentMessage = ugStub.broadcastToTopic.mock.calls[0][1] as Record<string, unknown>;
        expect(sentMessage).not.toHaveProperty('streamType');
    });

    it('passes streamType through to ChatStreamDO.init', async () => {
        const { env, streamStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            userMessageId: 'umsg-1',
            streamType: 'summary',
        });

        expect(streamStub.init).toHaveBeenCalledWith(
            'chat-1',
            'agent-1',
            'umsg-1',
            'chat',
            undefined, // previewAlias (5th)
            'summary',
        );
    });

    it('passes empty string for userMessageId when omitted', async () => {
        const { env, streamStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
        });

        expect(streamStub.init).toHaveBeenCalledWith('chat-1', 'agent-1', '', 'chat', undefined, undefined);
    });

    it("auto-subscribes the initiating user with the owner's UG DO name", async () => {
        const { env, streamStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
        });

        expect(streamStub.subscribe).toHaveBeenCalledWith('user-1', 'user-1');
    });

    it('appends @alias to UG and ChatStreamDO names on preview branches', async () => {
        const { env, ugIdFromName, streamIdFromName, streamStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            previewAlias: 'branch-a',
        });

        expect(ugIdFromName).toHaveBeenCalledWith('user-1@branch-a');
        expect(streamIdFromName).toHaveBeenCalledWith('agent-1@branch-a');
        expect(streamStub.subscribe).toHaveBeenCalledWith('user-1', 'user-1@branch-a');
        // Also lock previewAlias landing in the right positional slot.
        expect(streamStub.init).toHaveBeenCalledWith(
            'chat-1',
            'agent-1',
            '',
            'chat',
            'branch-a', // previewAlias (5th)
            undefined, // streamType (6th)
        );
    });

    it('supports intake prefix end-to-end', async () => {
        const { env, ugStub, streamStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'registerStream',
            prefix: 'intake',
            identifier: 'intake-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
            userMessageId: 'umsg-1',
        });

        expect(streamStub.init).toHaveBeenCalledWith(
            'intake-1',
            'agent-1',
            'umsg-1',
            'intake',
            undefined, // previewAlias
            undefined, // streamType
        );
        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('intake:intake-1', {
            topic: 'intake:intake-1',
            type: ServerMsg.StreamStarted,
            agentMessageId: 'agent-1',
            userMessageId: 'umsg-1',
        });
    });
});

// ============================================================================
// MESSAGE CREATED
// ============================================================================

describe('handleSystemAction messageCreated', () => {
    it('broadcasts a message_created tagged with the topic, without touching ChatStreamDO', async () => {
        const { env, ugStub, streamStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'messageCreated',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            message: { id: 'msg-1', role: 'user', content: 'hi' },
            tempId: '11111111-1111-1111-1111-111111111111',
        });

        expect(streamStub.init).not.toHaveBeenCalled();
        expect(streamStub.subscribe).not.toHaveBeenCalled();
        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('chat:chat-1', {
            topic: 'chat:chat-1',
            type: ServerMsg.MessageCreated,
            message: { id: 'msg-1', role: 'user', content: 'hi' },
            tempId: '11111111-1111-1111-1111-111111111111',
        });
    });

    it('omits tempId from the broadcast when not provided', async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'messageCreated',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            message: { id: 'msg-1' },
        });

        const sent = ugStub.broadcastToTopic.mock.calls[0][1] as Record<string, unknown>;
        expect(sent).not.toHaveProperty('tempId');
    });

    it('works for intake prefix', async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'messageCreated',
            prefix: 'intake',
            identifier: 'intake-1',
            userId: 'user-1',
            message: { id: 'msg-1' },
        });

        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('intake:intake-1', {
            topic: 'intake:intake-1',
            type: ServerMsg.MessageCreated,
            message: { id: 'msg-1' },
        });
    });
});

// ============================================================================
// MODEL CHANGED
// ============================================================================

describe('handleSystemAction modelChanged', () => {
    it('broadcasts a model_changed tagged with the topic', async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'modelChanged',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            model: 'sonnet',
        });

        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('chat:chat-1', {
            topic: 'chat:chat-1',
            type: ServerMsg.ModelChanged,
            model: 'sonnet',
        });
    });

    it('rejects intake prefix at runtime (chat-only by product semantics)', async () => {
        const { env, ugStub } = makeEnv();

        await expect(
            handleSystemAction(env, {
                action: 'modelChanged',
                prefix: 'intake',
                identifier: 'intake-1',
                userId: 'user-1',
                model: 'sonnet',
            }),
        ).rejects.toThrow(/modelChanged is only supported for prefix 'chat'/);

        expect(ugStub.broadcastToTopic).not.toHaveBeenCalled();
    });
});

// ============================================================================
// CB STATUS CHANGED
// ============================================================================

describe('handleSystemAction cbStatusChanged', () => {
    it('broadcasts a cb_status_changed tagged with the topic', async () => {
        const { env, ugStub } = makeEnv();

        await handleSystemAction(env, {
            action: 'cbStatusChanged',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            status: 'approved',
        });

        expect(ugStub.broadcastToTopic).toHaveBeenCalledWith('chat:chat-1', {
            topic: 'chat:chat-1',
            type: ServerMsg.CbStatusChanged,
            status: 'approved',
        });
    });

    it('rejects intake prefix at runtime', async () => {
        const { env, ugStub } = makeEnv();

        await expect(
            handleSystemAction(env, {
                action: 'cbStatusChanged',
                prefix: 'intake',
                identifier: 'intake-1',
                userId: 'user-1',
                status: 'approved',
            }),
        ).rejects.toThrow(/cbStatusChanged is only supported for prefix 'chat'/);

        expect(ugStub.broadcastToTopic).not.toHaveBeenCalled();
    });
});

// ============================================================================
// SCHEMA VALIDATION
// ============================================================================

describe('handleSystemAction schema validation', () => {
    it('rejects unknown actions before touching any DO', async () => {
        const { env, ugStub, streamStub } = makeEnv();

        await expect(
            handleSystemAction(env, {
                action: 'notARealAction',
                prefix: 'chat',
                identifier: 'chat-1',
                userId: 'user-1',
            }),
        ).rejects.toThrow();

        expect(ugStub.broadcastToTopic).not.toHaveBeenCalled();
        expect(streamStub.init).not.toHaveBeenCalled();
    });

    it('rejects registerStream missing agentMessageId', async () => {
        const { env } = makeEnv();

        await expect(
            handleSystemAction(env, {
                action: 'registerStream',
                prefix: 'chat',
                identifier: 'chat-1',
                userId: 'user-1',
            }),
        ).rejects.toThrow();
    });

    it('rejects messageCreated with malformed tempId', async () => {
        const { env } = makeEnv();

        await expect(
            handleSystemAction(env, {
                action: 'messageCreated',
                prefix: 'chat',
                identifier: 'chat-1',
                userId: 'user-1',
                message: { id: 'msg-1' },
                tempId: 'not-a-uuid',
            }),
        ).rejects.toThrow();
    });

    it('rejects empty userId', async () => {
        const { env } = makeEnv();

        await expect(
            handleSystemAction(env, {
                action: 'modelChanged',
                prefix: 'chat',
                identifier: 'chat-1',
                userId: '',
                model: 'sonnet',
            }),
        ).rejects.toThrow();
    });
});

// ============================================================================
// ENTRYPOINT INTEGRATION
// ============================================================================

describe('ChatServices.systemAction entrypoint', () => {
    it('routes through the entrypoint with the bound env', async () => {
        const { env, ugStub, streamStub } = makeEnv();
        const entry = new ChatServices({} as ExecutionContext, env);

        await entry.systemAction({
            action: 'registerStream',
            prefix: 'chat',
            identifier: 'chat-1',
            userId: 'user-1',
            agentMessageId: 'agent-1',
        });

        expect(streamStub.init).toHaveBeenCalledTimes(1);
        expect(streamStub.subscribe).toHaveBeenCalledTimes(1);
        expect(ugStub.broadcastToTopic).toHaveBeenCalledTimes(1);
    });
});
