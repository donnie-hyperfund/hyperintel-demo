'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { SEARCH_PARAMS } from '@/lib/search-params';

export function useOpenArtifactParam() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const key = searchParams.get(SEARCH_PARAMS.OPEN_ARTIFACT_KEY);
    const versionRaw = searchParams.get(SEARCH_PARAMS.OPEN_ARTIFACT_VERSION);
    const version = versionRaw ? Number(versionRaw) : null;

    const target = useMemo<{ key: string; version: number } | null>(() => {
        if (!key || version == null || !Number.isInteger(version) || version < 1) return null;
        return { key, version };
    }, [key, version]);

    const clear = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete(SEARCH_PARAMS.OPEN_ARTIFACT_KEY);
        params.delete(SEARCH_PARAMS.OPEN_ARTIFACT_VERSION);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [searchParams, router, pathname]);

    return { target, clear } as const;
}
