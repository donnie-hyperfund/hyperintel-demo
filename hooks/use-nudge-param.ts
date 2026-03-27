'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { SEARCH_PARAMS } from '@/lib/search-params';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

/**
 * Auto-nudge the agent when arriving via redirect (e.g. after restoring an artifact from another phase).
 * Reads the `?nudge=true` search param, calls `sendNudge` once the chat is ready, and cleans up the URL.
 */
export function useNudgeParam() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const { sendNudge, chatId, state } = useChatContext();
    const handledRef = useRef<string | null>(null);

    const nudgeParam = searchParams.get(SEARCH_PARAMS.NUDGE);

    useEffect(() => {
        // Wait for chat to be ready AND not generating — if generation is in flight,
        // sendNudge would no-op. By deferring, the effect re-fires once generation
        // completes (sendNudge ref changes when isGenerating changes).
        if (!nudgeParam || !chatId || state.isLoading || state.isGenerating || handledRef.current === nudgeParam)
            return;

        handledRef.current = nudgeParam;

        const params = new URLSearchParams(searchParams.toString());
        params.delete(SEARCH_PARAMS.NUDGE);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

        sendNudge();
    }, [nudgeParam, chatId, state.isLoading, state.isGenerating, sendNudge, searchParams, router, pathname]);
}
