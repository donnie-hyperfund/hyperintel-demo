// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSWRConfig } from 'swr';
import { ApiClientError } from '@/lib/api/client/types';
import { SwrProvider } from './swr-provider';

function wrapper({ children }: { children: ReactNode }) {
    return <SwrProvider>{children}</SwrProvider>;
}

describe('SwrProvider', () => {
    it('sets critical SWR defaults', () => {
        const { result } = renderHook(() => useSWRConfig(), { wrapper });

        expect(result.current.revalidateOnFocus).toBe(false);
        expect(result.current.revalidateIfStale).toBe(true);
        expect(result.current.dedupingInterval).toBe(2000);
        expect(result.current.errorRetryCount).toBe(3);
        expect(result.current.errorRetryInterval).toBe(5000);
    });

    it('retries only server-side ApiClient errors', () => {
        const { result } = renderHook(() => useSWRConfig(), { wrapper });
        const shouldRetryOnError = result.current.shouldRetryOnError;

        expect(typeof shouldRetryOnError).toBe('function');
        if (typeof shouldRetryOnError !== 'function') throw new Error('shouldRetryOnError is not configured');

        expect(shouldRetryOnError(new ApiClientError({ message: 'client-error', status: 400 }))).toBe(false);
        expect(shouldRetryOnError(new ApiClientError({ message: 'server-error', status: 500 }))).toBe(true);
        expect(shouldRetryOnError(new Error('unknown'))).toBe(true);
    });

    it('warns on unauthorized API errors', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = renderHook(() => useSWRConfig(), { wrapper });

        result.current.onError?.(
            new ApiClientError({ message: 'unauthorized', status: 401 }),
            '/api/resource',
            result.current,
        );

        expect(warnSpy).toHaveBeenCalledWith('[SWR] Unauthorized request:', '/api/resource');
        warnSpy.mockRestore();
    });

    it('does not warn for non-401 API errors', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = renderHook(() => useSWRConfig(), { wrapper });

        result.current.onError?.(
            new ApiClientError({ message: 'server-error', status: 500 }),
            '/api/resource',
            result.current,
        );

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
