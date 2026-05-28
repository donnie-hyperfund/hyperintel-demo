import { PublicError } from '@common/common/error.helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { runPhaseTransition } from './phase-transition';
import { phaseTransitionActionHandler } from './phase-transition-handler';

vi.mock('./chat-handler', () => ({
    chatActionHandler: vi.fn(),
}));

vi.mock('./phase-transition', () => ({
    PHASE_TRANSITION_STREAM_TYPE: 'phase_transition',
    runPhaseTransition: vi.fn(),
}));

describe('phaseTransitionActionHandler', () => {
    const ugStub = {
        systemAction: vi.fn(async () => undefined),
        broadcastToAll: vi.fn(async () => undefined),
    };
    const chatServices = {
        systemAction: vi.fn(async () => undefined),
    };

    function buildCtx({
        chatStatus = 'approved',
        nextChat = null,
    }: {
        chatStatus?: string | null;
        nextChat?: { id: string } | null;
    } = {}) {
        const chat = {
            id: 'chat-1',
            project: { id: 'project-1' },
            completion_brief_status: chatStatus,
            active_agent_message_id: null,
        };
        const em = {
            findOneOrFail: vi.fn(async (entity: unknown) => {
                expect(entity).toBe(ChatEntity);
                return chat;
            }),
            findOne: vi.fn(async () => nextChat),
            flush: vi.fn(async () => undefined),
        };
        const ctx = {
            em,
            env: {
                USER_GATEWAY: {
                    idFromName: vi.fn(() => 'ug-id'),
                    get: vi.fn(() => ugStub),
                },
                CHAT_SERVICES: chatServices,
                STREAM_AE: { writeDataPoint: vi.fn() },
                WORKER_NAME: 'hi-chat-test',
                WORKER_NAME_FULL: 'hi-chat-test',
            },
            user: { userId: 'user-1' },
            previewAlias: null,
        } as any;
        return { ctx, em, chat };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(runPhaseTransition).mockResolvedValue(true);
    });

    it('refuses to transition when a next-phase chat already exists', async () => {
        const { ctx, em, chat } = buildCtx({ nextChat: { id: 'next-chat-1' } });

        const result = await phaseTransitionActionHandler({ chatId: 'chat-1' }, ctx, { onEvent: vi.fn() });

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('CONTEXT_TOO_LONG');
        expect((result as PublicError).details).toMatchObject({
            source: 'already_transitioned',
            canForceBrief: false,
            existingNextChatId: 'next-chat-1',
        });
        expect(chat.active_agent_message_id).toBeNull();
        expect(em.flush).not.toHaveBeenCalled();
        expect(chatServices.systemAction).not.toHaveBeenCalled();
        expect(runPhaseTransition).not.toHaveBeenCalled();
    });

    it('registers a transition stream and calls runPhaseTransition for an approved CB', async () => {
        const { ctx, em, chat } = buildCtx();

        const result = await phaseTransitionActionHandler({ chatId: 'chat-1' }, ctx, { onEvent: vi.fn() });
        await (result as { generation: Promise<boolean> }).generation;

        expect(result).not.toBeInstanceOf(PublicError);
        expect(chat.active_agent_message_id).toBe((result as { agentMessageId: string }).agentMessageId);
        expect(em.flush).toHaveBeenCalledOnce();
        expect(chatServices.systemAction).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'registerStream',
                prefix: 'chat',
                identifier: 'chat-1',
                agentMessageId: (result as { agentMessageId: string }).agentMessageId,
                userId: 'user-1',
                streamType: 'phase_transition',
            }),
        );
        expect(runPhaseTransition).toHaveBeenCalledOnce();
    });
});
