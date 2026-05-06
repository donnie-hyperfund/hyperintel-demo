import { PublicError } from '@common/common/error.helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { runSummarizer } from './summarizer';
import { summarizeActionHandler } from './summarizer-handler';

vi.mock('./chat-handler', () => ({
    chatActionHandler: vi.fn(),
}));

vi.mock('./summarizer', () => ({
    runSummarizer: vi.fn(),
}));

describe('summarizeActionHandler', () => {
    const ugStub = {
        systemAction: vi.fn(async () => undefined),
        broadcastToAll: vi.fn(async () => undefined),
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
            },
            user: { userId: 'user-1' },
            previewAlias: null,
        } as any;
        return { ctx, em, chat };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(runSummarizer).mockResolvedValue(true);
    });

    it('refuses to summarize when a next-phase chat already exists', async () => {
        const { ctx, em, chat } = buildCtx({ nextChat: { id: 'next-chat-1' } });

        const result = await summarizeActionHandler({ chatId: 'chat-1' }, ctx, { onEvent: vi.fn() });

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('CONTEXT_TOO_LONG');
        expect((result as PublicError).details).toMatchObject({
            source: 'already_transitioned',
            canForceBrief: false,
            existingNextChatId: 'next-chat-1',
        });
        expect(chat.active_agent_message_id).toBeNull();
        expect(em.flush).not.toHaveBeenCalled();
        expect(ugStub.systemAction).not.toHaveBeenCalled();
        expect(runSummarizer).not.toHaveBeenCalled();
    });

    it('registers a summary stream and calls runSummarizer for an approved CB', async () => {
        const { ctx, em, chat } = buildCtx();

        const result = await summarizeActionHandler({ chatId: 'chat-1' }, ctx, { onEvent: vi.fn() });
        await (result as { generation: Promise<boolean> }).generation;

        expect(result).not.toBeInstanceOf(PublicError);
        expect(chat.active_agent_message_id).toBe((result as { agentMessageId: string }).agentMessageId);
        expect(em.flush).toHaveBeenCalledOnce();
        expect(ugStub.systemAction).toHaveBeenCalledWith(
            'chat:chat-1',
            'registerStream',
            expect.objectContaining({
                agentMessageId: (result as { agentMessageId: string }).agentMessageId,
                userId: 'user-1',
                streamType: 'summary',
            }),
            undefined,
        );
        expect(runSummarizer).toHaveBeenCalledOnce();
    });
});
