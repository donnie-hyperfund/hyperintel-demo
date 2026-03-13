// @vitest-environment jsdom

import { ANTHROPIC_MODELS } from '@common/ai/types';
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
const summarizeMock = vi.fn();
const openPanelMock = vi.fn();
const createApiClientMock = vi.fn();
const readStreamMock = vi.fn();

let selectedModelMock = ANTHROPIC_MODELS.SONNET;
let streamReaderOptions: {
    setIsLoading: (value: boolean) => void;
    onTerminalTool?: (toolName: string) => void;
    onDocumentStart?: () => void;
} | null = null;
let fallbackMock: Record<string, unknown> = {};

const cacheMock = new Map();
const artifactContextMock = {
    addArtifact: vi.fn(),
    updateArtifact: vi.fn(),
    getArtifact: vi.fn(),
};

const apiMock = {
    projects: {},
    chats: {
        create: vi.fn(),
        createIntake: vi.fn(),
        get: vi.fn(),
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
    summarize: (...args: Parameters<typeof summarizeMock>) => summarizeMock(...args),
}));

vi.mock('@/modules/artifacts/providers/artifact-provider', () => ({
    useArtifactContext: () => artifactContextMock,
}));

vi.mock('@/modules/chat/providers/active-panel-provider', () => ({
    useActivePanelContext: () => ({ openPanel: openPanelMock }),
}));

vi.mock('@/modules/chat/providers/model-selection-provider', () => ({
    useModelSelection: () => ({ selectedModel: selectedModelMock }),
}));

vi.mock('../hooks/use-stream-reader', () => ({
    useStreamReader: (options: { setIsLoading: (value: boolean) => void }) => {
        streamReaderOptions = options;
        return { readStream: readStreamMock };
    },
}));

function phaseWrapper({ children }: { children: ReactNode }) {
    return <ChatProvider projectId="project-1">{children}</ChatProvider>;
}

function phaseWithoutProjectWrapper({ children }: { children: ReactNode }) {
    return <ChatProvider>{children}</ChatProvider>;
}

function phaseWithInitialChatWrapper({ children }: { children: ReactNode }) {
    return (
        <ChatProvider projectId="project-1" initialChatId="chat-initial">
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

function createSSEBody(payload: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(payload));
            controller.close();
        },
    });
}

describe('ChatProvider', () => {
    beforeEach(() => {
        selectedModelMock = ANTHROPIC_MODELS.SONNET;
        fallbackMock = {};
        streamReaderOptions = null;

        getTokenMock.mockReset();
        getTokenMock.mockResolvedValue('token-abc');
        pushMock.mockReset();
        mutateMock.mockReset();
        unstableSerializeMock.mockClear();
        insertChatToCacheMock.mockReset();
        sendActionMock.mockReset();
        sendIntakeActionMock.mockReset();
        summarizeMock.mockReset();
        openPanelMock.mockReset();
        createApiClientMock.mockReset();
        readStreamMock.mockReset();
        readStreamMock.mockImplementation(async () => {
            streamReaderOptions?.setIsLoading(false);
        });

        cacheMock.clear();
        artifactContextMock.addArtifact.mockReset();
        artifactContextMock.updateArtifact.mockReset();
        artifactContextMock.getArtifact.mockReset();

        apiMock.chats.create.mockReset();
        apiMock.chats.createIntake.mockReset();
        apiMock.chats.get.mockReset();
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
                { id: 'm2', role: 'assistant', blocks: [], content: 'new', is_error: false },
                { id: 'm1', role: 'user', blocks: [], content: 'old', is_error: false },
            ],
            pagination: {
                page: 1,
                limit: 20,
                total: 2,
                totalPages: 2,
            },
        });
        apiMock.chats.get.mockResolvedValue({
            token_usage: {
                usedTokens: 12,
                tokenBreakdown: {
                    context: 2,
                    prompt: 3,
                    promptTool: 4,
                    toolDef: 3,
                },
            },
            has_pending_changes: true,
            phase_index: 2,
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
                    { id: 'm3', role: 'assistant', blocks: [], content: 'newest', is_error: false },
                    { id: 'm2', role: 'user', blocks: [], content: 'middle', is_error: false },
                ],
                pagination: {
                    page: 1,
                    limit: 20,
                    total: 3,
                    totalPages: 2,
                },
            })
            .mockResolvedValueOnce({
                data: [{ id: 'm1', role: 'assistant', blocks: [], content: 'oldest', is_error: false }],
                pagination: {
                    page: 2,
                    limit: 20,
                    total: 3,
                    totalPages: 2,
                },
            });

        apiMock.chats.get.mockResolvedValue({
            token_usage: null,
            has_pending_changes: false,
            phase_index: 1,
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
            phase_index: 3,
        });
        sendActionMock.mockResolvedValue({
            body: createSSEBody('data: {"type":"done"}\n\n'),
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        await act(async () => {
            await result.current.sendMessage('hello world');
        });

        expect(apiMock.chats.create).toHaveBeenCalledWith('project-1');
        expect(sendActionMock).toHaveBeenCalledWith(
            {
                message: 'hello world',
                chatId: 'chat-1',
                model: ANTHROPIC_MODELS.SONNET,
            },
            'token-abc',
        );
        expect(readStreamMock).toHaveBeenCalledTimes(1);
        expect(result.current.chatId).toBe('chat-1');
        expect(result.current.state.phaseIndex).toBe(3);
        expect(result.current.state.messages.at(-1)?.role).toBe('user');
        expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/project-1/chat-1');
        expect(insertChatToCacheMock).toHaveBeenCalledWith(cacheMock, mutateMock, {
            id: 'chat-1',
            phase_index: 3,
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

    it('creates intake chats for company mode and uses intake send endpoint', async () => {
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
        apiMock.chats.createIntake.mockResolvedValue({ id: 'company-chat-1' });
        sendIntakeActionMock.mockResolvedValue({
            body: createSSEBody('data: {"type":"done"}\n\n'),
        });

        const { result } = renderHook(() => useChatContext<'company'>(), { wrapper: companyWrapper });

        await act(async () => {
            await result.current.sendMessage('intake message');
        });

        expect(apiMock.chats.createIntake).toHaveBeenCalledWith({
            framework: 'cpf',
            category: 'principal',
        });
        expect(sendIntakeActionMock).toHaveBeenCalledWith(
            {
                message: 'intake message',
                chatId: 'company-chat-1',
                model: ANTHROPIC_MODELS.SONNET,
            },
            'token-abc',
        );
        expect(result.current.chatId).toBe('company-chat-1');
        expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/companies/company-chat-1');

        replaceStateSpy.mockRestore();
    });

    it('uses a custom route builder after creating an intake chat', async () => {
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
        apiMock.chats.createIntake.mockResolvedValue({ id: 'company-chat-2' });
        sendIntakeActionMock.mockResolvedValue({
            body: createSSEBody('data: {"type":"done"}\n\n'),
        });

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
        summarizeMock.mockResolvedValue({
            body: createSSEBody('data: {"type":"done","newChatId":"chat-2"}\n\n'),
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        act(() => {
            result.current.setChatId('chat-1');
        });

        await act(async () => {
            await result.current.summarizeChat();
        });

        expect(summarizeMock).toHaveBeenCalledWith({ chatId: 'chat-1' }, 'token-abc');
        expect(result.current.state.summaryNewChatId).toBe('chat-2');

        act(() => {
            result.current.navigateToNewPhase();
        });
        expect(pushMock).toHaveBeenCalledWith('/project-1/chat-2');
    });

    it('handles summarize stream error events', async () => {
        summarizeMock.mockResolvedValue({
            body: createSSEBody('data: {"type":"error","error":"summary failed"}\n\n'),
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        act(() => {
            result.current.setChatId('chat-1');
        });

        await act(async () => {
            await result.current.summarizeChat();
        });

        expect(result.current.state.isSummarizing).toBe(false);
        expect(result.current.state.error?.message).toBe('summary failed');
    });

    it('sets pending flags from stream callbacks and clears them via context methods', async () => {
        apiMock.chats.create.mockResolvedValue({
            id: 'chat-flag',
            phase_index: 1,
        });

        sendActionMock.mockResolvedValue({
            body: createSSEBody('data: {"type":"done"}\n\n'),
        });

        readStreamMock.mockImplementationOnce(async () => {
            streamReaderOptions?.onDocumentStart?.();
            streamReaderOptions?.onTerminalTool?.('generate_summary');
            streamReaderOptions?.setIsLoading(false);
        });

        const { result } = renderHook(() => useChatContext<'phase'>(), { wrapper: phaseWrapper });

        await act(async () => {
            await result.current.sendMessage('trigger pending flags');
        });

        expect(result.current.state.hasPendingChanges).toBe(true);
        expect(result.current.state.pendingPhaseTransition).toBe(true);

        act(() => {
            result.current.clearPendingChanges();
            result.current.clearPendingPhaseTransition();
        });

        expect(result.current.state.hasPendingChanges).toBe(false);
        expect(result.current.state.pendingPhaseTransition).toBe(false);
    });
});
