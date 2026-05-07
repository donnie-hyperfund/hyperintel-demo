'use client';

import { useLayoutEffect, useRef } from 'react';
import { type UseAutoScrollReturn, useAutoScroll } from '@/hooks/use-auto-scroll';

type UseArtifactScrollProps = {
    artifactId: string;
    versionNumber: number | undefined;
    content: string;
    summaryContent: string;
    isStreaming: boolean;
};

type UseArtifactScrollReturn = Pick<
    UseAutoScrollReturn<HTMLDivElement>,
    'containerRef' | 'isAtBottom' | 'scrollToBottom'
>;

export function useArtifactScroll({
    artifactId,
    versionNumber,
    content,
    summaryContent,
    isStreaming,
}: UseArtifactScrollProps): UseArtifactScrollReturn {
    const { containerRef, isAtBottom, isFollowing, scrollToBottom, scrollToTop } = useAutoScroll<HTMLDivElement>([], {
        initialFollow: isStreaming,
        disabled: true,
    });

    const prevArtifactIdRef = useRef(artifactId);
    const prevVersionRef = useRef(versionNumber);
    const prevStreamingRef = useRef(isStreaming);

    useLayoutEffect(() => {
        const prevId = prevArtifactIdRef.current;
        const prevStreaming = prevStreamingRef.current;
        prevArtifactIdRef.current = artifactId;
        prevStreamingRef.current = isStreaming;

        if (prevId !== artifactId) {
            if (isStreaming) scrollToBottom({ behavior: 'instant' });
            else scrollToTop({ behavior: 'instant' });
            return;
        }
        if (!prevStreaming && isStreaming) scrollToBottom({ behavior: 'instant' });
    }, [artifactId, isStreaming, scrollToBottom, scrollToTop]);

    useLayoutEffect(() => {
        const prev = prevVersionRef.current;
        prevVersionRef.current = versionNumber;
        if (!isStreaming || versionNumber === undefined) return;
        if (prev === undefined || prev === versionNumber) return;
        scrollToBottom({ behavior: 'instant' });
    }, [versionNumber, isStreaming, scrollToBottom]);

    useLayoutEffect(() => {
        if (!isFollowing()) return;
        scrollToBottom({ behavior: 'instant' });
    }, [content, summaryContent, scrollToBottom, isFollowing]);

    return { containerRef, isAtBottom, scrollToBottom };
}
