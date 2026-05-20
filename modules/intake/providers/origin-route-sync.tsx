'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { type ProjectOrigin, parseProjectOrigin } from '@/lib/intake/project-origin';

type OriginRouteSyncProps = {
    onChange: (origin: ProjectOrigin | null) => void;
};

export function OriginRouteSync({ onChange }: OriginRouteSyncProps) {
    const searchParams = useSearchParams();
    const origin = useMemo(() => parseProjectOrigin(searchParams), [searchParams]);

    useEffect(() => {
        onChange(origin);
    }, [origin, onChange]);

    return null;
}
