'use client';

import { type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { ApiClientError } from '@/lib/api/client/types';

interface SwrProviderProps {
    children: ReactNode;
}

export function SwrProvider({ children }: SwrProviderProps) {
    return (
        <SWRConfig
            value={{
                revalidateOnFocus: false,
                revalidateIfStale: true,
                dedupingInterval: 2000,
                errorRetryCount: 3,
                errorRetryInterval: 5000,
                shouldRetryOnError: (error) => {
                    if (error instanceof ApiClientError) {
                        return error.status >= 500;
                    }
                    return true;
                },
                onError: (error, key) => {
                    if (error instanceof ApiClientError && error.status === 401) {
                        console.warn('[SWR] Unauthorized request:', key);
                    }
                },
            }}
        >
            {children}
        </SWRConfig>
    );
}
