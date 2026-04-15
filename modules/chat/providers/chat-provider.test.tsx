// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
const openPanelMock = vi.fn();
const createApiClientMock = vi.fn();
const hasPendingNudgeMock = vi.fn();
const clearPendingNudgeMock = vi.fn();

let selectedModelMock = 'sonnet';
let streamReaderOptions: {
    setIsLoading: (value: boolean) => void;
    onTerminalTool?: (toolName: string) => void;
    onDocumentStart?: () => void;
} | null = null;
let fallbackMock: Record<string, unknown> = {};

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
    useActivePanelContext: () => ({ openPanel: openPanelMock, closePanel: closePanelMock, panelState: null }),
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

function companyWithProjectOriginWrapper({ children }: { children: ReactNode }) {
    return (
        <ChatProvider
            chatType="company"
            chatRouteBuilder={(chatId) => `/companies/${chatId}?origin=project&projectId=project-1`}
        >
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
        associateUploadsMock.mockReset();
        summarizeMock.mockReset();
        openPanelMock.mockReset();
        closePanelMock.mockReset();
        setSelectedModelMock.mockReset();
        setIsChangingModelMock.mockReset();
        createApiClientMock.mockReset();
        hasPendingNudgeMock.mockReset();
        hasPendingNudgeMock.mockReturnValue(false);
        clearPendingNudgeMock.mockReset();

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

        await waitFor(() => {
            expect(apiMock.messages.list).toHaveBeenCalledWith('chat-initial', { page: 1 });
        });

        await waitFor(() => {
            expect(result.current.state.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
            expect(result.current.state.tokenUsage?.usedTokens).toBe(12);
            expect(result.current.state.hasPendingChanges).toBe(true);
            expect(result.current.state.phaseIndex).toBe(2);
            expect(result.current.pagination.hasMore).toBe(true);
        });
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

        await waitFor(() => {
            expect(result.current.state.messages.map((message) => message.id)).toEqual(['m2', 'm3']);
        });

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
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

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
        expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/project-1/chat-1');
        expect(insertChatToCacheMock).toHaveBeenCalledWith(cacheMock, mutateMock, 'project-1', {
            id: 'chat-1',
            phaseIndex: 3,
        });

        replaceStateSpy.mockRestore();
    });

    it('surfaces an error when phase chat send is attempted without project id', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useChatContext<'phase'>(), {
            wrapper: phaseWithoutProjectWrapper,
        });

        await act(async () => {
            await result.current.sendMessage('hello');
        });

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

        await act(async () => {
            await result.current.sendMessage('hello', { imageFileIds: ['file-1'] });
        });

        expect(associateUploadsMock).toHaveBeenCalledWith({ imageFileIds: ['file-1'], chatId: 'chat-initial' }, 'token-abc');
        expect(sendActionMock).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(result.current.state.error?.message).toContain('Associate uploads failed: 500');
        });
        consoleSpy.mockRestore();
    });

    it('creates intake chats for company mode and uses intake send endpoint', async () => {
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
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
        expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/companies/company-chat-1');

        replaceStateSpy.mockRestore();
    });

    it('uses a custom route builder after creating an intake chat', async () => {
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
        apiMock.chats.createIntake.mockResolvedValue({ id: 'company-chat-2' });
        sendIntakeActionMock.mockResolvedValue(mockResponse());

        const { result } = renderHook(() => useChatContext<'company'>(), { wrapper: companyWithProjectOriginWrapper });

        await act(async () => {
            await result.current.sendMessage('intake message');
        });

        expect(replaceStateSpy).toHaveBeenCalledWith(
            null,
            '',
            '/companies/company-chat-2?origin=project&projectId=project-1',
        );

        replaceStateSpy.mockRestore();
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
        // summaryNewChatId is set via WS stream events, not the HTTP response.
        // navigateToNewPhase is a no-op until WS delivers the new chat ID.
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

    it('seeds hasPendingChanges from cache and clears via context methods', async () => {
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
});
