import { PublicError } from '@common/common/error.helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatActionHandler } from '../chat-handler';
import { intakeActionHandler } from '../intake-handler';
import { CHAT_CONTEXT_HARD_LIMIT_TOKENS, CHAT_CONTEXT_WARNING_TOKENS } from './context-budget';

const getPromptContentMock = vi.fn();
const loadChatHistoryMock = vi.fn();
const estimateInferenceInputTokensMock = vi.fn();

vi.mock('./prompt-loader', () => ({
    DEFAULT_LOCAL_PROMPTS_PATH: 'zlocal/prompts',
    getPromptContent: (...args: unknown[]) => getPromptContentMock(...args),
    parseLocalPromptEnv: () => null,
}));

vi.mock('./stream-utils', () => ({
    cleanupStreamDO: vi.fn(),
    createEnqueue: vi.fn(),
    createSSEStream: vi.fn(),
    loadChatHistory: (...args: unknown[]) => loadChatHistoryMock(...args),
    persistErrorMessage: vi.fn(),
}));

vi.mock('./context-budget', async () => {
    const actual = await vi.importActual<typeof import('./context-budget')>('./context-budget');
    return {
        ...actual,
        estimateInferenceInputTokens: (...args: unknown[]) => estimateInferenceInputTokensMock(...args),
    };
});

interface BuildCtxOpts {
    chatMetadata?: Record<string, unknown>;
    findReturn?: unknown[];
}

function buildEm({ chatMetadata = {}, findReturn = [] }: BuildCtxOpts = {}) {
    return {
        findOneOrFail: vi
            .fn()
            .mockResolvedValue({ id: 'chat-1', metadata: chatMetadata, project: { id: 'proj-1' } }),
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockResolvedValue(findReturn),
        create: vi.fn((_entity, data) => ({ ...data, toJSON: () => data })),
        persist: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
    };
}

function buildCtx(em: ReturnType<typeof buildEm>) {
    const ugStub = {
        systemAction: vi.fn().mockResolvedValue(undefined),
        broadcastToAll: vi.fn().mockResolvedValue(undefined),
    };
    return {
        em,
        env: {
            USER_GATEWAY: {
                idFromName: vi.fn().mockReturnValue('ug-id'),
                get: vi.fn().mockReturnValue(ugStub),
            },
        },
        user: { userId: 'user-1' },
        previewAlias: null,
    };
}

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

describe('phase chat preflight — context gates', () => {
    beforeEach(() => {
        getPromptContentMock.mockReset().mockResolvedValue('prompt');
        loadChatHistoryMock.mockReset().mockResolvedValue([{ role: 'assistant', content: 'history' }]);
        estimateInferenceInputTokensMock.mockReset();
    });

    function expectGate(result: unknown, gate: 'warning' | 'hard') {
        expect(result).toBeInstanceOf(PublicError);
        const err = result as PublicError;
        expect(err.code).toBe('CONTEXT_TOO_LONG');
        const details = err.details as Record<string, unknown>;
        expect(details.gate).toBe(gate);
        return details;
    }

    it('below warning: returns no PublicError (preflight passes)', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(50_000);
        const em = buildEm();
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: false, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        expect(result).not.toBeInstanceOf(PublicError);
        expect(em.create).toHaveBeenCalled();
    });

    it('above warning, no flags: returns warning gate error', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(CHAT_CONTEXT_WARNING_TOKENS + 1);
        const em = buildEm();
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: false, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        const details = expectGate(result, 'warning');
        expect(details.source).toBe('estimator');
        expect(details.canBypass).toBe(true);
        expect(details.canForceBrief).toBe(true);
        expect(em.create).not.toHaveBeenCalled();
    });

    it('above warning with bypass_context_warning: preflight passes', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(CHAT_CONTEXT_WARNING_TOKENS + 1);
        const em = buildEm();
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: true, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        expect(result).not.toBeInstanceOf(PublicError);
        expect(em.create).toHaveBeenCalled();
    });

    it('above hard, no force_brief: returns hard gate error (bypass_context_warning is irrelevant)', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1);
        const em = buildEm();
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: true, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        const details = expectGate(result, 'hard');
        expect(details.source).toBe('estimator');
        expect(details.canBypass).toBe(false);
        expect(details.canForceBrief).toBe(true);
    });

    it('above hard with force_brief: preflight passes (forced-brief path takes over)', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1);
        // force_brief requires message: null (nudge); seed last message as user role so nudge proceeds.
        const em = buildEm({ findReturn: [{ role: 'user', content: 'last user msg' }] });
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: null, model: 'sonnet', bypass_context_warning: false, force_brief: true },
            ctx as any,
            { useLocalPrompts: true },
        );

        expect(result).not.toBeInstanceOf(PublicError);
    });

    it('metadata.contextOverflow === "soft" with low estimator: returns warning gate with provider_error source', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(50_000);
        const em = buildEm({ chatMetadata: { contextOverflow: 'soft' } });
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: false, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        const details = expectGate(result, 'warning');
        expect(details.source).toBe('provider_error');
        expect(details.canBypass).toBe(true);
        expect(details.canForceBrief).toBe(true);
    });

    it('metadata.contextOverflow === "soft" with low estimator + bypass: preflight passes', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(50_000);
        const em = buildEm({ chatMetadata: { contextOverflow: 'soft' } });
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: true, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        expect(result).not.toBeInstanceOf(PublicError);
    });

    it('metadata.contextOverflow === "hard" with low estimator: returns hard gate with provider_error source', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(50_000);
        const em = buildEm({ chatMetadata: { contextOverflow: 'hard' } });
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: false, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        const details = expectGate(result, 'hard');
        expect(details.source).toBe('provider_error');
        expect(details.canBypass).toBe(false);
        expect(details.canForceBrief).toBe(true);
    });

    it('metadata "hard" upgrades estimator soft to hard gate (stricter wins)', async () => {
        // Bug: old code returned soft warning here because the estimator block returned early
        // before the metadata block could upgrade to hard.
        estimateInferenceInputTokensMock.mockReturnValue(CHAT_CONTEXT_WARNING_TOKENS + 1);
        const em = buildEm({ chatMetadata: { contextOverflow: 'hard' } });
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: false, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        const details = expectGate(result, 'hard');
        expect(details.source).toBe('provider_error');
        expect(details.canBypass).toBe(false);
        expect(details.canForceBrief).toBe(true);
    });

    it('estimator hard wins over metadata "soft" (stricter gate wins)', async () => {
        estimateInferenceInputTokensMock.mockReturnValue(CHAT_CONTEXT_HARD_LIMIT_TOKENS + 1);
        const em = buildEm({ chatMetadata: { contextOverflow: 'soft' } });
        const ctx = buildCtx(em);

        const result = await chatActionHandler(
            { chatId: 'chat-1', message: 'hello', model: 'sonnet', bypass_context_warning: false, force_brief: false },
            ctx as any,
            { useLocalPrompts: true },
        );

        const details = expectGate(result, 'hard');
        // Estimator path → source: 'estimator', not 'provider_error'.
        expect(details.source).toBe('estimator');
    });
});
