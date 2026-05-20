'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { SEARCH_PARAMS } from '@/lib/search-params';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

export function usePanelIntentParam() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const { pushPanel } = useActivePanelContext();
    const handledRef = useRef<string | null>(null);

    const panelIntent = searchParams.get(SEARCH_PARAMS.OPEN_PANEL);

    useEffect(() => {
        if (panelIntent !== 'resources' || handledRef.current === panelIntent) return;

        pushPanel({ panel: 'resources' }, { reset: true });
        handledRef.current = panelIntent;

        const params = new URLSearchParams(searchParams.toString());
        params.delete(SEARCH_PARAMS.OPEN_PANEL);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pushPanel, panelIntent, searchParams, router, pathname]);
}
