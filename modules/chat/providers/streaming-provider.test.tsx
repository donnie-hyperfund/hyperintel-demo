// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StreamingProvider, useStreamingContext } from './streaming-provider';

const createStreamProcessorMock = vi.fn();

vi.mock('../services/stream-parser', () => ({
    createStreamProcessor: (...args: Parameters<typeof createStreamProcessorMock>) =>
        createStreamProcessorMock(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
    return <StreamingProvider>{children}</StreamingProvider>;
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
}

describe('StreamingProvider', () => {
    beforeEach(() => {
        createStreamProcessorMock.mockReset();
        createStreamProcessorMock.mockImplementation((onEvent: (event: { type: string; text?: string }) => void) => ({
            processChunk(chunk: string) {
                if (chunk.includes('emit')) {
                    onEvent({ type: 'delta', text: 'parsed-chunk' });
                }
            },
            flush() {
                onEvent({ type: 'done' });
            },
            reset() {},
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('throws when hook is used outside provider', () => {
        expect(() => renderHook(() => useStreamingContext())).toThrow(
            'useStreaming must be used within a StreamingProvider',
        );
    });

    it('streams data, emits parsed events to subscribers, and ends cleanly', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: streamFromChunks(['emit']),
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useStreamingContext(), { wrapper });
        const subscriber = vi.fn();
        const unsubscribe = result.current.subscribe(subscriber);

        await act(async () => {
            result.current.startStream('/api/chat');
        });

        await waitFor(() => {
            expect(result.current.state.isStreaming).toBe(false);
        });

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/chat',
            expect.objectContaining({
                headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
                signal: expect.any(AbortSignal),
            }),
        );
        expect(subscriber).toHaveBeenCalledWith({ type: 'delta', text: 'parsed-chunk' });
        expect(subscriber).toHaveBeenCalledWith({ type: 'done' });

        unsubscribe();
    });

    it('aborts in-flight streams and clears streaming state', () => {
        const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useStreamingContext(), { wrapper });

        let controller: AbortController | undefined;
        act(() => {
            controller = result.current.startStream('/api/slow');
        });

        expect(result.current.state.isStreaming).toBe(true);

        act(() => {
            result.current.abort();
        });

        expect(controller?.signal.aborted).toBe(true);
        expect(result.current.state.isStreaming).toBe(false);
    });

    it('aborts any previous stream when a new stream starts', () => {
        const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useStreamingContext(), { wrapper });

        let first: AbortController | undefined;
        let second: AbortController | undefined;
        act(() => {
            first = result.current.startStream('/api/one');
            second = result.current.startStream('/api/two');
        });

        expect(first?.signal.aborted).toBe(true);
        expect(second?.signal.aborted).toBe(false);
    });

    it('stops delivering events after unsubscribe', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: streamFromChunks(['emit']),
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useStreamingContext(), { wrapper });
        const subscriber = vi.fn();
        const unsubscribe = result.current.subscribe(subscriber);
        unsubscribe();

        await act(async () => {
            result.current.startStream('/api/chat');
        });

        await waitFor(() => {
            expect(result.current.state.isStreaming).toBe(false);
        });
        expect(subscriber).not.toHaveBeenCalled();
    });

    it('emits stream errors for non-2xx responses', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Server Error',
            body: null,
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useStreamingContext(), { wrapper });
        const subscriber = vi.fn();
        result.current.subscribe(subscriber);

        await act(async () => {
            result.current.startStream('/api/fail');
        });

        await waitFor(() => {
            expect(result.current.state.error?.message).toBe('HTTP 500: Server Error');
        });

        expect(result.current.state.isStreaming).toBe(false);
        expect(subscriber).toHaveBeenCalledWith({ type: 'error', error: 'HTTP 500: Server Error' });
    });
});
