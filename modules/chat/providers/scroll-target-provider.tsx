'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useOpenArtifactParam } from '@/hooks/use-open-artifact-param';
import { useScrollToArtifactParam } from '@/hooks/use-scroll-to-artifact-param';
import { useArtifactStreamMonitor } from '@/modules/artifacts/streaming/artifact-stream-monitor-provider';
import { useActivePanelContext } from './active-panel-provider';
import { useChatContext } from './chat-provider';

type ScrollTarget = { key: string; version: number | null };

type ScrollTargetContextValue = {
    target: ScrollTarget | null;
    foundRef: React.RefObject<boolean>;
    /** Called by the matching ArtifactIndicator to signal it exists in the DOM */
    markFound: () => void;
    clear: () => void;
    /** Set a scroll target directly without URL navigation */
    scrollTo: (target: ScrollTarget) => void;
};

const ScrollTargetContext = createContext<ScrollTargetContextValue>({
    target: null,
    foundRef: { current: false },
    markFound: () => {},
    clear: () => {},
    scrollTo: () => {},
});

export function ScrollTargetProvider({ children }: { children: ReactNode }) {
    const { target: paramTarget, clear: clearParams } = useScrollToArtifactParam();
    const { target: openTarget, clear: clearOpenParams } = useOpenArtifactParam();
    const { pushPanel } = useActivePanelContext();
    const streamMonitor = useArtifactStreamMonitor();
    const { chatId } = useChatContext();
    const [target, setTarget] = useState<ScrollTarget | null>(null);
    const foundRef = useRef(false);
    const clearParamsRef = useRef(clearParams);
    clearParamsRef.current = clearParams;
    const clearOpenParamsRef = useRef(clearOpenParams);
    clearOpenParamsRef.current = clearOpenParams;

    // Absorb URL params into local state, then immediately clean the URL.
    useEffect(() => {
        if (!paramTarget) return;

        setTarget(paramTarget);
        foundRef.current = false;
        clearParamsRef.current();
    }, [paramTarget]);

    useEffect(() => {
        if (!openTarget) return;

        pushPanel(
            { panel: 'artifact-preview', artifactId: openTarget.key, version: openTarget.version },
            { reset: true },
        );
        clearOpenParamsRef.current();
    }, [openTarget, pushPanel]);

    useEffect(() => {
        if (!chatId) return;
        streamMonitor.setActivationHandler(chatId, (artifactKey, version) => {
            pushPanel({ panel: 'artifact-preview', artifactId: artifactKey, version }, { reset: true });
        });
        return () => streamMonitor.setActivationHandler(chatId, null);
    }, [streamMonitor, chatId, pushPanel]);

    const markFound = useCallback(() => {
        foundRef.current = true;
    }, []);

    const clear = useCallback(() => {
        setTarget(null);
        foundRef.current = false;
    }, []);

    const scrollTo = useCallback((next: ScrollTarget) => {
        setTarget(next);
        foundRef.current = false;
    }, []);

    const value = useMemo(
        () => ({ target, foundRef, markFound, clear, scrollTo }),
        [target, markFound, clear, scrollTo],
    );
    return <ScrollTargetContext.Provider value={value}>{children}</ScrollTargetContext.Provider>;
}

export function useScrollTargetContext() {
    return useContext(ScrollTargetContext);
}
