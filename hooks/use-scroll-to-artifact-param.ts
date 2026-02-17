'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export function useScrollToArtifactParam() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const key = searchParams.get('scrollArtifactKey');
    const versionRaw = searchParams.get('scrollArtifactVersion');
    const version = versionRaw ? Number(versionRaw) : null;

    const target = useMemo(() => {
        if (!key) return null;
        return { key, version };
    }, [key, version]);

    const clear = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('scrollArtifactKey');
        params.delete('scrollArtifactVersion');
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [searchParams, router, pathname]);

    return { target, clear } as const;
}
