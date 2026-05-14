import { randomUUID } from 'node:crypto';
import {
    MockCFWebSocket,
    MockDurableObjectId,
    MockDurableObjectNamespace,
    MockDurableObjectState,
} from '@common/common/local.do-mock';
import { makeSecretMock } from '@common/common/local.helpers';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ClientAction, ServerMsg } from '@/lib/schema/ws-protocol';
import { clearDatabase, closeTestOrm, getTestEm } from '@/tests/helpers/db';
import { ChatServices } from '@/workers/services/src';
import { ChatStreamDO } from '@/workers/objects/src/objects/chat-stream-do';
import { UserGateway } from '@/workers/objects/src/objects/user-gateway';

const HAS_DB = !!process.env.DATABASE_URL;

type CapturedRaw = {
    sends: string[];
    closed: { code?: number; reason?: string } | null;
    readyState: number;
};

function createCapturedSocket(): { raw: CapturedRaw; ws: MockCFWebSocket } {
    const raw: CapturedRaw = { sends: [], closed: null, readyState: 1 };
    const ws = new MockCFWebSocket({
        send: (data: string) => {
            raw.sends.push(data);
        },
        close: (code?: number, reason?: string) => {
            raw.closed = { code, reason };
            raw.readyState = 3;
        },
        get readyState() {
            return raw.readyState;
        },
    });
    return { raw, ws };
}

function parseSends(raw: CapturedRaw): Record<string, unknown>[] {
    return raw.sends.map((send) => JSON.parse(send) as Record<string, unknown>);
}

function createEnv(overrides: Partial<ObjectsEnv> = {}): ObjectsEnv {
    const env: Record<string, unknown> = {
        DATABASE_URL: makeSecretMock(process.env.DATABASE_URL ?? ''),
        CLERK_SECRET_KEY: makeSecretMock('sk_test'),
        CLERK_PUBLISHABLE_KEY: 'pk_test',
        STREAM_AE: { writeDataPoint: vi.fn() },
        ...overrides,
    };

    env.CHAT_SERVICES ??= new ChatServices({} as ExecutionContext, env as unknown as ServicesEnv);
    env.USER_GATEWAY ??= new MockDurableObjectNamespace(UserGateway as never, env);
    env.CHAT_STREAM_DO ??= new MockDurableObjectNamespace(ChatStreamDO as never, env);
    return env as unknown as ObjectsEnv;
}

function createGateway(
    userId: string,
    env = createEnv(),
): {
    ctx: MockDurableObjectState;
    raw: CapturedRaw;
    ug: UserGateway;
    ws: MockCFWebSocket;
} {
    const ctx = new MockDurableObjectState(new MockDurableObjectId(userId));
    const ug = new UserGateway(ctx as unknown as DurableObjectState, env);
    const { raw, ws } = createCapturedSocket();
    ws.serializeAttachment({ userId, subscribedTopics: [], sessionExpiry: undefined });
    ctx.acceptWebSocket(ws, [randomUUID()]);
    return { ctx, raw, ug, ws };
}

async function sendClient(ug: UserGateway, ws: MockCFWebSocket, payload: object): Promise<void> {
    await ug.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(payload));
}

async function seedProjectChat(options: {
    clerkId: string;
    selectedModel?: string | null;
    completionBriefStatus?: string | null;
    activeAgentMessageId?: string | null;
}): Promise<{ chatId: string; projectId: string; userId: string }> {
    const em = await getTestEm();
    const user = em.create(UserEntity, {
        email: `${options.clerkId}@stream-services.test`,
        emailConfirmed: true,
        clerkId: options.clerkId,
    });
    const project = em.create(ProjectEntity, { name: `Stream services ${options.clerkId}`, user });
    const chat = em.create(ChatEntity, {
        phase: 'chat',
        phase_index: 0,
        project,
        selected_model: options.selectedModel ?? null,
        completion_brief_status: options.completionBriefStatus ?? null,
        active_agent_message_id: options.activeAgentMessageId ?? null,
    });
    await em.persistAndFlush([user, project, chat]);
    return { chatId: chat.id, projectId: project.id, userId: user.id };
}

async function seedIntakeChat(clerkId: string): Promise<{ chatId: string; userId: string }> {
    const em = await getTestEm();
    const user = em.create(UserEntity, {
        email: `${clerkId}@stream-services.test`,
        emailConfirmed: true,
        clerkId,
    });
    const chat = em.create(ChatEntity, {
        type: 'intake',
        phase: 'intake',
        phase_index: 0,
        user,
        metadata: { framework: 'cpf' },
    });
    await em.persistAndFlush([user, chat]);
    return { chatId: chat.id, userId: user.id };
}

async function readChat(chatId: string): Promise<{ active_agent_message_id: string | null }> {
    const em = await getTestEm();
    const rows = await em.execute<{ active_agent_message_id: string | null }[]>(
        'SELECT active_agent_message_id FROM chats WHERE id = ?',
        [chatId],
    );
    return rows[0];
}

describe.skipIf(!HAS_DB)('stream services DB-backed e2e', () => {
    beforeEach(async () => {
        await clearDatabase();
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await clearDatabase();
        await closeTestOrm();
    });

    it('subscribes to an owned chat through UG -> CHAT_SERVICES -> SQL and returns metadata', async () => {
        const clerkId = 'stream-services-chat-owner';
        const { chatId } = await seedProjectChat({
            clerkId,
            selectedModel: 'gpt-5.4',
            completionBriefStatus: 'approved',
        });
        const { raw, ug, ws } = createGateway(clerkId);

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: `chat:${chatId}` });

        const response = parseSends(raw).find((msg) => msg.type === ServerMsg.SubscribeResponse);
        expect(response).toMatchObject({
            topic: `chat:${chatId}`,
            type: ServerMsg.SubscribeResponse,
            status: 'idle',
            selectedModel: 'gpt-5.4',
            completionBriefStatus: 'approved',
        });
    });

    it('denies a chat subscribe for a non-owner through real services SQL', async () => {
        const { chatId } = await seedProjectChat({ clerkId: 'stream-services-chat-owner' });
        const { raw, ug, ws } = createGateway('stream-services-chat-intruder');

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: `chat:${chatId}` });

        const error = parseSends(raw).find((msg) => msg.type === ServerMsg.Error);
        expect(error).toMatchObject({ type: ServerMsg.Error, error: 'Forbidden', action: ClientAction.Subscribe });
        const attachment = ws.deserializeAttachment() as { subscribedTopics: string[] };
        expect(attachment.subscribedTopics).not.toContain(`chat:${chatId}`);
    });

    it('subscribes to an owned intake chat through UG -> CHAT_SERVICES -> SQL', async () => {
        const clerkId = 'stream-services-intake-owner';
        const { chatId } = await seedIntakeChat(clerkId);
        const { raw, ug, ws } = createGateway(clerkId);

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: `intake:${chatId}` });

        const response = parseSends(raw).find((msg) => msg.type === ServerMsg.SubscribeResponse);
        expect(response).toMatchObject({
            topic: `intake:${chatId}`,
            type: ServerMsg.SubscribeResponse,
            status: 'idle',
        });
    });

    it('fails subscribe closed when the services policy binding fails', async () => {
        const clerkId = 'stream-services-policy-failure';
        const { chatId } = await seedProjectChat({ clerkId });
        const env = createEnv({
            CHAT_SERVICES: {
                getTopicSubscribeInfo: vi.fn(async () => {
                    throw new Error('policy unavailable');
                }),
            } as unknown as ObjectsEnv['CHAT_SERVICES'],
        });
        const { raw, ug, ws } = createGateway(clerkId, env);

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: `chat:${chatId}` });

        const error = parseSends(raw).find((msg) => msg.type === ServerMsg.Error);
        expect(error).toMatchObject({ type: ServerMsg.Error, error: 'Forbidden', action: ClientAction.Subscribe });
        const attachment = ws.deserializeAttachment() as { subscribedTopics: string[] };
        expect(attachment.subscribedTopics).not.toContain(`chat:${chatId}`);
    });

    it('clears stale active_agent_message_id through services SQL when subscribing to a terminal stream', async () => {
        const clerkId = 'stream-services-stale-cleanup';
        const agentMessageId = randomUUID();
        const { chatId } = await seedProjectChat({ clerkId, activeAgentMessageId: agentMessageId });
        const env = createEnv();
        const { raw, ug, ws } = createGateway(clerkId, env);

        await ug.systemAction(`chat:${chatId}`, 'registerStream', {
            agentMessageId,
            userMessageId: randomUUID(),
        });
        const stream = env.CHAT_STREAM_DO.get(env.CHAT_STREAM_DO.idFromName(agentMessageId)) as unknown as ChatStreamDO;
        await stream.done();
        const clearSpy = vi.spyOn(env.CHAT_SERVICES, 'clearActiveStream');

        await sendClient(ug, ws, { action: ClientAction.Subscribe, topic: `chat:${chatId}` });

        const response = parseSends(raw).find((msg) => msg.type === ServerMsg.SubscribeResponse);
        expect(response).toMatchObject({ topic: `chat:${chatId}`, status: 'idle' });
        expect(clearSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                agentMessageId,
                identifier: chatId,
            }),
        );
        await expect(readChat(chatId)).resolves.toMatchObject({ active_agent_message_id: null });

        await stream.finalize();
    });

    it('dead-man cleanup inserts an errored placeholder and clears active_agent_message_id through services SQL', async () => {
        const clerkId = 'stream-services-dead-man';
        const agentMessageId = randomUUID();
        const { chatId } = await seedProjectChat({ clerkId, activeAgentMessageId: agentMessageId });
        const env = createEnv();
        const stream = env.CHAT_STREAM_DO.get(env.CHAT_STREAM_DO.idFromName(agentMessageId)) as unknown as ChatStreamDO;
        await stream.init(chatId, agentMessageId, randomUUID(), 'chat');
        await stream.push([], 0);

        await stream.alarm();

        await expect(readChat(chatId)).resolves.toMatchObject({ active_agent_message_id: null });
        const em = await getTestEm();
        const messages = await em.execute<
            Array<{ id: string; chat_id: string; role: string; content: string; is_error: boolean }>
        >('SELECT id, chat_id, role, content, is_error FROM chat_messages WHERE id = ?', [agentMessageId]);
        expect(messages).toEqual([
            {
                id: agentMessageId,
                chat_id: chatId,
                role: 'assistant',
                content: '',
                is_error: true,
            },
        ]);
    });
});
