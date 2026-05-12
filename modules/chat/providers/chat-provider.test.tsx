// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatProvider, useChatContext } from './chat-provider';

const getTokenMock = vi.fn();
const pushMock = vi.fn();
const mutateMock = vi.fn();
const unstableSerializeMock = vi.fn((value: unknown) => JSON.stringify(value));
const insertChatToCacheMock = vi.fn();
const sendActionMock = vi.fn();
const sendIntakeActionMock = vi.fn();
const associateUploadsMock = vi.fn();
const summarizeMock = vi.fn();
const pushPanelMock = vi.fn();
const createApiClientMock = vi.fn();
const hasPendingNudgeMock = vi.fn();
const clearPendingNudgeMock = vi.fn();
const onChatCreatedMock = vi.fn();

let selectedModelMock = 'sonnet';
let fallbackMock: Record<string, unknown> = {};
let wsMessageHandlers: Array<(message: unknown) => void> = [];

function emitWsMessage(message: unknown) {
    for (const handler of wsMessageHandlers) {
        handler(message);
    }
}

const cacheMock = new Map();
const artifactContextMock = {
    addArtifact: vi.fn(),
    removeArtifact: vi.fn(),
    updateArtifact: vi.fn(),
    getArtifact: vi.fn(),
    getStore: vi.fn(() => ({})),
};

const apiMock = {
    projects: {},
    chats: {
        create: vi.fn(),
        createIntake: vi.fn(),
        get: vi.fn(),
        updateModel: vi.fn(),
    },
    messages: {
        list: vi.fn(),
    },
    artifacts: {
        getByKey: vi.fn(),
    },
    projectArtifacts: {
        getByKey: vi.fn(),
    },
};

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => ({ getToken: getTokenMock }),
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: pushMock }),
}));

vi.mock('swr', () => ({
    useSWRConfig: () => ({
        mutate: mutateMock,
        cache: cacheMock,
        fallback: fallbackMock,
    }),
    unstable_serialize: (...args: Parameters<typeof unstableSerializeMock>) => unstableSerializeMock(...args),
}));

vi.mock('@/lib/api/client', () => ({
    createApiClient: (...args: Parameters<typeof createApiClientMock>) => createApiClientMock(...args),
}));

vi.mock('@/lib/api/client/cache/chats', () => ({
    insertChatToCache: (...args: Parameters<typeof insertChatToCacheMock>) => insertChatToCacheMock(...args),
}));

vi.mock('@/lib/api/requests/worker/chat', () => ({
    sendAction: (...args: Parameters<typeof sendActionMock>) => sendActionMock(...args),
    sendIntakeAction: (...args: Parameters<typeof sendIntakeActionMock>) => sendIntakeActionMock(...args),
    associateUploads: (...args: Parameters<typeof associateUploadsMock>) => associateUploadsMock(...args),
    summarize: (...args: Parameters<typeof summarizeMock>) => summarizeMock(...args),
}));

vi.mock('@/modules/artifacts/providers/artifact-provider', () => ({
    useArtifactActions: () => artifactContextMock,
}));

vi.mock('@/modules/artifacts/processing/artifact-processing-provider', () => ({
    useArtifactProcessing: () => ({
        hasPendingNudge: (...args: Parameters<typeof hasPendingNudgeMock>) => hasPendingNudgeMock(...args),
        clearPendingNudge: (...args: Parameters<typeof clearPendingNudgeMock>) => clearPendingNudgeMock(...args),
    }),
}));

const wsMock = { send: vi.fn(), subscribe: vi.fn(() => vi.fn()), on: vi.fn(), off: vi.fn() };
vi.mock('@/lib/websocket/provider', () => ({
    useWebsocket: () => wsMock,
}));

const closePanelMock = vi.fn();
vi.mock('@/modules/chat/providers/active-panel-provider', () => ({
    useActivePanelContext: () => ({
        pushPanel: pushPanelMock,
        closePanel: closePanelMock,
        popPanel: vi.fn(),
        togglePanel: vi.fn(),
        canGoBack: false,
        panelState: null,
    }),
}));

const setSelectedModelMock = vi.fn();
const setIsChangingModelMock = vi.fn();
vi.mock('@/modules/chat/providers/model-selection-provider', () => ({
    useModelSelection: () => ({
        selectedModel: selectedModelMock,
        setSelectedModel: setSelectedModelMock,
        isModelAvailable: true,
        setIsChangingModel: setIsChangingModelMock,
    }),
}));

vi.mock('@/modules/intake/providers/project-origin-provider', () => ({
    useOptionalProjectOrigin: () => ({
        isProjectFlow: false,
        handleApprovedArtifact: vi.fn(),
    }),
}));

function phaseWrapper({ children }: { children: ReactNode }) {
    return (
        <ChatProvider chatType="phase" projectId="project-1">
            {children}
        </ChatProvider>
    );
}

function phaseWithoutProjectWrapper({ children }: { children: ReactNode }) {
    return <ChatProvider chatType="phase">{children}</ChatProvider>;
}

function phaseWithInitialChatWrapper({ children }: { children: ReactNode }) {
    return (
        <ChatProvider chatType="phase" projectId="project-1" initialChatId="chat-initial">
            {children}
        </ChatProvider>
    );
}

function companyWrapper({ children }: { children: ReactNode }) {
    return <ChatProvider chatType="company">{children}</ChatProvider>;
}

function companyWithChatCreatedEventWrapper({ children }: { children: ReactNode }) {
    return (
        <ChatProvider chatType="company" onChatCreated={onChatCreatedMock}>
            {children}
        </ChatProvider>
    );
}

function mockResponse(body: unknown = {}, opts: { ok?: boolean; status?: number } = {}): Response {
    const { ok = true, status = ok ? 200 : 500 } = opts;
    return {
        ok,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
}

describe('ChatProvider', () => {
    beforeEach(() => {
        selectedModelMock = 'sonnet';
        fallbackMock = {};

        getTokenMock.mockReset();
        getTokenMock.mockResolvedValue('token-abc');
        pushMock.mockReset();
        mutateMock.mockReset();
        unstableSerializeMock.mockClear();
        insertChatToCacheMock.mockReset();
        sendActionMock.mockReset();
        sendIntakeActionMock.mockReset();
        onChatCreatedMock.mockReset();
        associateUploadsMock.mockReset();
        summarizeMock.mockReset();
        pushPanelMock.mockReset();
        closePanelMock.mockReset();
        setSelectedModelMock.mockReset();
        setIsChangingModelMock.mockReset();
        createApiClientMock.mockReset();
        hasPendingNudgeMock.mockReset();
        hasPendingNudgeMock.mockReturnValue(false);
        clearPendingNudgeMock.mockReset();
        wsMessageHandlers = [];
        wsMock.send.mockReset();
        wsMock.subscribe.mockReset().mockReturnValue(vi.fn());
        wsMock.on.mockReset().mockImplementation((event: string, handler: (message: unknown) => void) => {
            if (event === 'message') wsMessageHandlers.push(handler);
        });
        wsMock.off.mockReset().mockImplementation((event: string, handler: (message: unknown) => void) => {
            if (event === 'message') wsMessageHandlers = wsMessageHandlers.filter((h) => h !== handler);
        });

        cacheMock.clear();
        artifactContextMock.addArtifact.mockReset();
        artifactContextMock.removeArtifact.mockReset();
        artifactContextMock.updateArtifact.mockReset();
        artifactContextMock.getArtifact.mockReset();
        artifactContextMock.getStore.mockReset().mockReturnValue({});

        apiMock.chats.create.mockReset();
        apiMock.chats.createIntake.mockReset();
        apiMock.chats.get.mockReset();
        apiMock.chats.updateModel.mockReset();
        apiMock.chats.updateModel.mockResolvedValue(undefined);
        apiMock.messages.list.mockReset();
        apiMock.messages.list.mockResolvedValue({
            data: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
        });
        apiMock.chats.get.mockResolvedValue({
            tokenUsage: null,
            hasPendingChanges: false,
            phaseIndex: 1,
        });
        apiMock.artifacts.getByKey.mockReset();
        apiMock.projectArtifacts.getByKey.mockReset();

        createApiClientMock.mockReturnValue(apiMock);
    });

    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useChatContext())).toThrow('useChatContext must be used within a ChatProvider');
    });

    it('loads initial chat messages in chronological order', async () => {
        apiMock.messages.list.mockResolvedValue({
            data: [
                { id: 'm2', role: 'assistant', blocks: [], content: 'new', isError: false },
                { id: 'm1', role: 'user', blocks: [], content: 'old', isError: false },
            ],
            pagination: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 2,
            },
        });
        apiMock.chats.get.mockResolvedValue({
            tokenUsage: {
                usedTokens: 12,
                tokenBreakdown: {
                    context: 2,
                    prompt: 3,
                    promptTool: 4,
                    toolDef: 3,
                },
            },
            hasPendingChanges: true,
            phaseIndex: 2,
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWithInitialChatWrapper });

        await act(async () => {
            await result.current.openChat('chat-initial');
        });

        expect(apiMock.messages.list).toHaveBeenCalledWith('chat-initial', { page: 1 });
        expect(result.current.state.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
        expect(result.current.state.tokenUsage?.usedTokens).toBe(12);
        expect(result.current.state.hasPendingChanges).toBe(true);
        expect(result.current.state.phaseIndex).toBe(2);
        expect(result.current.pagination.hasMore).toBe(true);
    });

    it('loads more messages and prepends older pages for infinite scroll', async () => {
        apiMock.messages.list
            .mockResolvedValueOnce({
                data: [
                    { id: 'm3', role: 'assistant', blocks: [], content: 'newest', isError: false },
                    { id: 'm2', role: 'user', blocks: [], content: 'middle', isError: false },
                ],
                pagination: {
                    page: 1,
                    limit: 20,
                    total: 3,
                    totalPages: 2,
                },
            })
            .mockResolvedValueOnce({
                data: [{ id: 'm1', role: 'assistant', blocks: [], content: 'oldest', isError: false }],
                pagination: {
                    page: 2,
                    limit: 20,
                    total: 3,
                    totalPages: 2,
                },
            });

        apiMock.chats.get.mockResolvedValue({
            tokenUsage: null,
            hasPendingChanges: false,
            phaseIndex: 1,
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWithInitialChatWrapper });

        await act(async () => {
            await result.current.openChat('chat-initial');
        });

        expect(result.current.state.messages.map((message) => message.id)).toEqual(['m2', 'm3']);

        await act(async () => {
            await result.current.loadMoreMessages();
        });

        expect(apiMock.messages.list).toHaveBeenNthCalledWith(2, 'chat-initial', { page: 2 });
        expect(result.current.state.messages.map((message) => message.id)).toEqual(['m1', 'm2', 'm3']);
        expect(result.current.pagination.hasMore).toBe(false);
    });

    it('does not send empty messages', async () => {
        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        await act(async () => {
            await result.current.sendMessage('   ');
        });

        expect(apiMock.chats.create).not.toHaveBeenCalled();
        expect(sendActionMock).not.toHaveBeenCalled();
        expect(result.current.state.messages).toHaveLength(0);
    });

    it('creates a new phase chat and sends a message when chat id is missing', async () => {
        apiMock.chats.create.mockResolvedValue({
            id: 'chat-1',
            phaseIndex: 3,
        });
        sendActionMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        await act(async () => {
            await result.current.sendMessage('hello world');
        });

        expect(apiMock.chats.create).toHaveBeenCalledWith('project-1');
        expect(sendActionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'hello world',
                chatId: 'chat-1',
                model: 'sonnet',
            }),
            'token-abc',
        );
        expect(result.current.chatId).toBe('chat-1');
        expect(result.current.state.phaseIndex).toBe(3);
        expect(result.current.state.messages.at(-1)?.role).toBe('user');
        expect(insertChatToCacheMock).toHaveBeenCalledWith(cacheMock, mutateMock, 'project-1', {
            id: 'chat-1',
            phaseIndex: 3,
        });
    });

    it('surfaces an error when phase chat send is attempted without project id', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithoutProjectWrapper,
        });

        let caught: unknown;
        await act(async () => {
            try {
                await result.current.sendMessage('hello');
            } catch (error) {
                caught = error;
            }
        });

        expect(caught).toEqual(expect.objectContaining({ message: 'Project ID is required for phase chats' }));

        await waitFor(() => {
            expect(result.current.state.error?.message).toBe('Project ID is required for phase chats');
        });
        expect(sendActionMock).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('surfaces an error and skips sending when upload association fails', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        associateUploadsMock.mockResolvedValue(mockResponse('association failed', { ok: false, status: 500 }));

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        let caught: unknown;
        await act(async () => {
            try {
                await result.current.sendMessage('hello', { imageFileIds: ['file-1'] });
            } catch (error) {
                caught = error;
            }
        });

        expect(caught).toEqual(
            expect.objectContaining({ message: expect.stringContaining('Associate uploads failed: 500') }),
        );

        expect(associateUploadsMock).toHaveBeenCalledWith(
            { imageFileIds: ['file-1'], chatId: 'chat-initial', projectId: 'project-1' },
            'token-abc',
        );
        expect(sendActionMock).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(result.current.state.error?.message).toContain('Associate uploads failed: 500');
        });
        consoleSpy.mockRestore();
    });

    it('shows context limit alert and suppresses generic error state when send is rejected for context length', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        sendActionMock.mockResolvedValue(
            mockResponse(
                {
                    code: 'CONTEXT_TOO_LONG',
                    message: 'This phase has reached the context limit.',
                },
                { ok: false, status: 400 },
            ),
        );

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        let caught: unknown;
        await act(async () => {
            try {
                await result.current.sendMessage('hello');
            } catch (error) {
                caught = error;
            }
        });

        expect(caught).toMatchObject({
            name: 'ApiClientError',
            code: 'CONTEXT_TOO_LONG',
            message: 'This phase has reached the context limit.',
        });

        expect(sendActionMock).toHaveBeenCalled();
        expect(result.current.state.showContextLimitAlert).toBe(true);
        expect(result.current.state.error).toBeNull();
        expect(result.current.state.messages).toHaveLength(0);

        act(() => {
            result.current.dismissContextLimitAlert();
        });

        expect(result.current.state.showContextLimitAlert).toBe(false);
        consoleSpy.mockRestore();
    });

    it('passes bypass_context_warning only when explicitly requested', async () => {
        apiMock.chats.create.mockResolvedValueOnce({ id: 'chat-normal', phaseIndex: 1 });
        sendActionMock.mockResolvedValue(mockResponse());

        const normal = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWrapper,
        });

        await act(async () => {
            await normal.result.current.sendMessage('normal');
        });

        expect(sendActionMock).toHaveBeenLastCalledWith(
            expect.not.objectContaining({ bypass_context_warning: true }),
            'token-abc',
        );

        normal.unmount();
        sendActionMock.mockClear();
        apiMock.chats.create.mockResolvedValueOnce({ id: 'chat-bypassed', phaseIndex: 1 });

        const bypassed = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWrapper,
        });

        await act(async () => {
            await bypassed.result.current.sendMessage('bypassed', { bypassContextWarning: true });
        });

        expect(sendActionMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ message: 'bypassed', bypass_context_warning: true }),
            'token-abc',
        );
    });

    it('opens the soft warning modal for warning-gate context errors', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        sendActionMock.mockResolvedValue(
            mockResponse(
                {
                    code: 'CONTEXT_TOO_LONG',
                    message: 'Approaching context limit.',
                    details: { gate: 'warning' },
                },
                { ok: false, status: 400 },
            ),
        );

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await act(async () => {
            await expect(result.current.sendMessage('hello')).rejects.toMatchObject({
                code: 'CONTEXT_TOO_LONG',
            });
        });

        expect(result.current.state.showContextWarningModal).toBe(true);
        expect(result.current.state.hardStopModalState).toBe('closed');
        expect(result.current.state.showContextLimitAlert).toBe(false);
        expect(result.current.state.error).toBeNull();
        consoleSpy.mockRestore();
    });

    it('opens the hard-stop modal for hard-gate context errors', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        sendActionMock.mockResolvedValue(
            mockResponse(
                {
                    code: 'CONTEXT_TOO_LONG',
                    message: 'Context limit reached.',
                    details: { gate: 'hard' },
                },
                { ok: false, status: 400 },
            ),
        );

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await act(async () => {
            await expect(result.current.sendMessage('hello')).rejects.toMatchObject({
                code: 'CONTEXT_TOO_LONG',
            });
        });

        expect(result.current.state.hardStopModalState).toBe('idle');
        expect(result.current.state.hardStopExistingNextChatId).toBeNull();
        expect(result.current.state.showContextWarningModal).toBe(false);
        expect(result.current.state.error).toBeNull();
        consoleSpy.mockRestore();
    });

    it('uses already-transitioned hard-stop state when backend says force brief is unavailable', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        sendActionMock.mockResolvedValue(
            mockResponse(
                {
                    code: 'CONTEXT_TOO_LONG',
                    message: 'Context limit reached.',
                    details: { gate: 'hard', canForceBrief: false, existingNextChatId: 'chat-next' },
                },
                { ok: false, status: 400 },
            ),
        );

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await act(async () => {
            await expect(result.current.sendMessage('hello')).rejects.toMatchObject({
                code: 'CONTEXT_TOO_LONG',
            });
        });

        expect(result.current.state.hardStopModalState).toBe('already-transitioned');
        expect(result.current.state.hardStopExistingNextChatId).toBe('chat-next');
        consoleSpy.mockRestore();
    });

    it('opens the hard-stop modal for streamed context-length errors', async () => {
        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await waitFor(() => {
            expect(wsMock.on).toHaveBeenCalledWith('message', expect.any(Function));
        });

        act(() => {
            emitWsMessage({
                type: 'stream_started',
                topic: 'chat:chat-initial',
                agentMessageId: 'agent-1',
                userMessageId: 'user-1',
            });
        });

        await waitFor(() => {
            expect(result.current.state.activeResponseId).toBe('agent-1');
            expect(result.current.state.messages.at(-1)).toMatchObject({
                id: 'agent-1',
                role: 'assistant',
                isStreaming: true,
            });
        });

        act(() => {
            emitWsMessage({
                type: 'stream_event',
                topic: 'chat:chat-initial',
                agentMessageId: 'agent-1',
                event: {
                    type: 'done',
                    error: 'CONTEXT_TOO_LONG',
                    messageMetadata: {
                        error: { code: 'CONTEXT_TOO_LONG', retryable: false },
                    },
                },
            });
        });

        expect(result.current.state.hardStopModalState).toBe('idle');
        expect(result.current.state.showContextLimitAlert).toBe(false);
        expect(result.current.state.activeResponseId).toBeNull();
        expect(result.current.state.messages.at(-1)).toMatchObject({
            id: 'agent-1',
            isStreaming: false,
            metadata: { error: { code: 'CONTEXT_TOO_LONG', retryable: false } },
        });
        expect(result.current.state.messages.at(-1)?.isError).toBeUndefined();
    });

    it('opens the hard-stop modal for invalid request streamed errors when context is already hard-overflowed', async () => {
        apiMock.chats.get.mockResolvedValue({
            tokenUsage: null,
            hasPendingChanges: false,
            phaseIndex: 1,
            metadata: { contextOverflow: 'hard' },
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await waitFor(() => {
            expect(result.current.state.contextOverflow).toBe('hard');
        });

        act(() => {
            emitWsMessage({
                type: 'stream_started',
                topic: 'chat:chat-initial',
                agentMessageId: 'agent-invalid-request',
                userMessageId: 'user-1',
            });
        });

        await waitFor(() => {
            expect(result.current.state.activeResponseId).toBe('agent-invalid-request');
            expect(result.current.state.messages.at(-1)).toMatchObject({
                id: 'agent-invalid-request',
                role: 'assistant',
                isStreaming: true,
            });
        });

        act(() => {
            emitWsMessage({
                type: 'stream_event',
                topic: 'chat:chat-initial',
                agentMessageId: 'agent-invalid-request',
                event: {
                    type: 'done',
                    error: 'INVALID_REQUEST',
                    messageMetadata: {
                        error: { code: 'INVALID_REQUEST', retryable: false },
                    },
                },
            });
        });

        expect(result.current.state.hardStopModalState).toBe('idle');
        expect(result.current.state.messages.at(-1)).toMatchObject({
            id: 'agent-invalid-request',
            isStreaming: false,
            metadata: { error: { code: 'INVALID_REQUEST', retryable: false } },
        });
        expect(result.current.state.messages.at(-1)?.isError).toBeUndefined();
    });

    it('includes projectId when associating uploads after creating a new phase chat', async () => {
        apiMock.chats.create.mockResolvedValue({
            id: 'chat-1',
            phaseIndex: 3,
        });
        associateUploadsMock.mockResolvedValue(mockResponse({ associatedArtifacts: 1, associatedImages: 0 }));
        sendActionMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        await act(async () => {
            await result.current.sendMessage('hello world', { stagedArtifactIds: ['artifact-1'] });
        });

        expect(associateUploadsMock).toHaveBeenCalledWith(
            { artifactIds: ['artifact-1'], chatId: 'chat-1', projectId: 'project-1' },
            'token-abc',
        );
        expect(sendActionMock).toHaveBeenCalled();
    });

    it('creates intake chats for company mode and uses intake send endpoint', async () => {
        apiMock.chats.createIntake.mockResolvedValue({ id: 'company-chat-1' });
        sendIntakeActionMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'company'>(), { wrapper: companyWrapper });

        await act(async () => {
            await result.current.sendMessage('intake message');
        });

        expect(apiMock.chats.createIntake).toHaveBeenCalledWith({
            framework: 'cpf',
            category: 'principal',
        });
        expect(sendIntakeActionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'intake message',
                chatId: 'company-chat-1',
                model: 'sonnet',
            }),
            'token-abc',
        );
        expect(result.current.chatId).toBe('company-chat-1');
    });

    it('emits a created chat event after creating an intake chat', async () => {
        apiMock.chats.createIntake.mockResolvedValue({ id: 'company-chat-2' });
        sendIntakeActionMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'company'>(), {
            wrapper: companyWithChatCreatedEventWrapper,
        });

        await act(async () => {
            await result.current.sendMessage('intake message');
        });

        expect(onChatCreatedMock).toHaveBeenCalledWith('company-chat-2');
    });

    it('summarizes and navigates to the new phase chat', async () => {
        summarizeMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        act(() => {
            result.current.setChatId('chat-1');
        });

        await act(async () => {
            await result.current.summarizeChat();
        });

        expect(summarizeMock).toHaveBeenCalledWith({ chatId: 'chat-1' }, 'token-abc');
        expect(result.current.state.summaryNewChatId).toBeNull();
        expect(result.current.state.error).toBeNull();
    });

    it('handles summarize HTTP error', async () => {
        summarizeMock.mockResolvedValue(mockResponse('summary failed', { ok: false, status: 500 }));

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        act(() => {
            result.current.setChatId('chat-1');
        });

        await act(async () => {
            await result.current.summarizeChat();
        });

        expect(result.current.state.isSummarizing).toBe(false);
        expect(result.current.state.error?.message).toBe('Summarize failed: 500 — summary failed');
    });

    it('sends force_brief as a null-message nudge and enters forcing state', async () => {
        sendActionMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await act(async () => {
            await result.current.sendForceBrief();
        });

        expect(sendActionMock).toHaveBeenCalledWith(
            { message: null, chatId: 'chat-initial', model: 'sonnet', force_brief: true },
            'token-abc',
        );
        expect(result.current.state.hardStopModalState).toBe('forcing');
        expect(result.current.state.hardStopError).toBeNull();
    });

    it('surfaces force-brief failures from user events while forcing', async () => {
        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        act(() => {
            result.current.dismissHardStopModal();
        });

        sendActionMock.mockResolvedValue(mockResponse());
        await act(async () => {
            await result.current.sendForceBrief();
        });

        act(() => {
            emitWsMessage({
                type: 'user_event',
                eventType: 'context_limit_transition_update',
                payload: {
                    chatId: 'chat-initial',
                    status: 'failed',
                    message: 'Summary failed',
                },
            });
        });

        expect(result.current.state.hardStopModalState).toBe('idle');
        expect(result.current.state.hardStopError).toBe('Summary failed');
    });

    it('seeds hasPendingChanges from cache and clears via context methods', () => {
        // hasPendingChanges is seeded from the SWR-cached chat detail
        const cacheKey = JSON.stringify(['chats', 'detail', 'chat-initial']);
        fallbackMock = {
            [cacheKey]: {
                tokenUsage: null,
                hasPendingChanges: true,
                phaseIndex: 1,
            },
        };

        apiMock.chats.get.mockResolvedValue({
            tokenUsage: null,
            hasPendingChanges: true,
            phaseIndex: 1,
        });
        apiMock.messages.list.mockResolvedValue({
            data: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        expect(result.current.state.hasPendingChanges).toBe(true);

        act(() => {
            result.current.clearPendingChanges();
        });

        expect(result.current.state.hasPendingChanges).toBe(false);
    });

    it('restores context overflow and forced-transition state when loading an existing chat', async () => {
        apiMock.messages.list.mockResolvedValue({
            data: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
        });
        apiMock.chats.get.mockResolvedValue({
            tokenUsage: null,
            hasPendingChanges: false,
            phaseIndex: 1,
            metadata: {
                contextOverflow: 'hard',
                contextLimitTransition: {
                    status: 'failed',
                    message: 'Approval failed',
                },
            },
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithInitialChatWrapper,
        });

        await act(async () => {
            await result.current.openChat('chat-initial');
        });

        expect(result.current.state.contextOverflow).toBe('hard');
        expect(result.current.state.hardStopModalState).toBe('idle');
        expect(result.current.state.hardStopError).toBe('Approval failed');
    });
});
