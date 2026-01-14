'use client';

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { createStreamProcessor } from '../services/stream-parser';
import type { StreamEvent, StreamState, StreamSubscriber } from '../types';

export type StreamingContextValue = {
    state: StreamState;
    subscribe: (callback: StreamSubscriber) => () => void;
    startStream: (url: string, init?: RequestInit) => AbortController;
    abort: () => void;
};

const StreamingContext = createContext<StreamingContextValue | null>(null);

type StreamingProviderProps = {
    children: ReactNode;
};

export function StreamingProvider({ children }: StreamingProviderProps) {
    const [state, setState] = useState<StreamState>({
        isStreaming: false,
        error: null,
    });

    const subscribersRef = useRef<Set<StreamSubscriber>>(new Set());
    const abortControllerRef = useRef<AbortController | null>(null);

    const subscribe = useCallback((callback: StreamSubscriber) => {
        subscribersRef.current.add(callback);
        return () => {
            subscribersRef.current.delete(callback);
        };
    }, []);

    const emit = useCallback((event: StreamEvent) => {
        subscribersRef.current.forEach((callback) => {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in stream subscriber:', error);
            }
        });
    }, []);

    const abort = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setState((prev) => ({ ...prev, isStreaming: false }));
    }, []);

    const startStream = useCallback(
        (url: string, init?: RequestInit): AbortController => {
            // Abort any existing stream
            abort();

            const controller = new AbortController();
            abortControllerRef.current = controller;

            setState({ isStreaming: true, error: null });

            // Start the async stream consumption
            (async () => {
                try {
                    const response = await fetch(url, {
                        ...init,
                        signal: controller.signal,
                        headers: {
                            'Content-Type': 'application/json',
                            ...init?.headers,
                        },
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    if (!response.body) {
                        throw new Error('Response body is null');
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    const processor = createStreamProcessor(emit);

                    while (true) {
                        const { done, value } = await reader.read();

                        if (done) {
                            processor.flush();
                            emit({ type: 'done' });
                            break;
                        }

                        const chunk = decoder.decode(value, { stream: true });
                        processor.processChunk(chunk);
                    }
                } catch (error) {
                    if (error instanceof Error && error.name === 'AbortError') {
                        // Stream was intentionally aborted
                        return;
                    }

                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    setState((prev) => ({ ...prev, error: error as Error }));
                    emit({ type: 'error', error: errorMessage });
                } finally {
                    setState((prev) => ({ ...prev, isStreaming: false }));
                    abortControllerRef.current = null;
                }
            })();

            return controller;
        },
        [abort, emit],
    );

    const value: StreamingContextValue = {
        state,
        subscribe,
        startStream,
        abort,
    };

    return <StreamingContext.Provider value={value}>{children}</StreamingContext.Provider>;
}

export function useStreamingContext(): StreamingContextValue {
    const context = useContext(StreamingContext);
    if (!context) {
        throw new Error('useStreaming must be used within a StreamingProvider');
    }
    return context;
}
