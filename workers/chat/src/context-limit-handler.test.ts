import { PublicError } from '@common/common/error.helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatActionHandler } from './chat-handler';
import { intakeActionHandler } from './intake-handler';

const getPromptContentMock = vi.fn();
const loadChatHistoryMock = vi.fn();
const estimateInferenceInputTokensMock = vi.fn();

vi.mock('./utils/prompt-loader', () => ({
    DEFAULT_LOCAL_PROMPTS_PATH: 'zlocal/prompts',
    getPromptContent: (...args: unknown[]) => getPromptContentMock(...args),
    parseLocalPromptEnv: () => null,
}));

vi.mock('./utils/stream-utils', () => ({
    cleanupStreamDO: vi.fn(),
    createEnqueue: vi.fn(),
    createSSEStream: vi.fn(),
    loadChatHistory: (...args: unknown[]) => loadChatHistoryMock(...args),
    persistErrorMessage: vi.fn(),
}));

vi.mock('./utils/context-budget', async () => {
    const actual = await vi.importActual<typeof import('./utils/context-budget')>('./utils/context-budget');
    return {
        ...actual,
        estimateInferenceInputTokens: (...args: unknown[]) => estimateInferenceInputTokensMock(...args),
    };
});

describe('chat context limit preflight', () => {
    beforeEach(() => {
        getPromptContentMock.mockReset().mockResolvedValue('prompt');
        loadChatHistoryMock.mockReset().mockResolvedValue([{ role: 'assistant', content: 'history' }]);
        estimateInferenceInputTokensMock.mockReset().mockReturnValue(190_001);
    });

    it('rejects phase chat sends before persisting or registering a stream', async () => {
        const em = {
            findOneOrFail: vi.fn().mockResolvedValue({ id: 'chat-1', metadata: {}, project: {} }),
            create: vi.fn(),
            persist: vi.fn(),
            flush: vi.fn(),
        };
        const ctx = {
            em,
            env: {},
            user: { userId: 'user-1' },
        };

        const result = await chatActionHandler({ chatId: 'chat-1', message: 'hello', model: 'sonnet' }, ctx as any, {
            useLocalPrompts: true,
        });

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('CONTEXT_TOO_LONG');
        expect(em.create).not.toHaveBeenCalled();
        expect(em.persist).not.toHaveBeenCalled();
        expect(em.flush).not.toHaveBeenCalled();
        expect(estimateInferenceInputTokensMock).toHaveBeenCalledWith(
            expect.objectContaining({
                context: [
                    { role: 'assistant', content: 'history' },
                    { role: 'user', content: 'hello' },
                ],
            }),
        );
    });

    it('rejects intake sends before persisting or registering a stream', async () => {
        const em = {
            findOneOrFail: vi.fn().mockResolvedValue({
                id: 'intake-chat-1',
                metadata: { framework: 'cpf', category: 'principal' },
                user: { id: 'user-db-1' },
            }),
            create: vi.fn(),
            persist: vi.fn(),
            flush: vi.fn(),
        };
        const ctx = {
            em,
            env: {},
            user: { userId: 'user-1' },
        };

        const result = await intakeActionHandler(
            { chatId: 'intake-chat-1', message: 'hello', model: 'sonnet' },
            ctx as any,
            { useLocalPrompts: true },
        );

        expect(result).toBeInstanceOf(PublicError);
        expect((result as PublicError).code).toBe('CONTEXT_TOO_LONG');
        expect((result as PublicError).message).toBe(
            'This conversation has reached the context limit. Start a new conversation before continuing.',
        );
        expect(em.create).not.toHaveBeenCalled();
        expect(em.persist).not.toHaveBeenCalled();
        expect(em.flush).not.toHaveBeenCalled();
        expect(estimateInferenceInputTokensMock).toHaveBeenCalledWith(
            expect.objectContaining({
                context: [
                    { role: 'assistant', content: 'history' },
                    { role: 'user', content: 'hello' },
                ],
            }),
        );
    });
});
