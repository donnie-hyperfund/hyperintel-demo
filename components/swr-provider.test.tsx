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

        expect(result.current.shouldRetryOnError?.(new ApiClientError('client-error', 400))).toBe(false);
        expect(result.current.shouldRetryOnError?.(new ApiClientError('server-error', 500))).toBe(true);
        expect(result.current.shouldRetryOnError?.(new Error('unknown'))).toBe(true);
    });

    it('warns on unauthorized API errors', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = renderHook(() => useSWRConfig(), { wrapper });

        result.current.onError?.(new ApiClientError('unauthorized', 401), '/api/resource');

        expect(warnSpy).toHaveBeenCalledWith('[SWR] Unauthorized request:', '/api/resource');
        warnSpy.mockRestore();
    });

    it('does not warn for non-401 API errors', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { result } = renderHook(() => useSWRConfig(), { wrapper });

        result.current.onError?.(new ApiClientError('server-error', 500), '/api/resource');

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
