'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useScrollToArtifactParam } from '@/hooks/use-scroll-to-artifact-param';

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
    const [target, setTarget] = useState<ScrollTarget | null>(null);
    const foundRef = useRef(false);
    const clearParamsRef = useRef(clearParams);
    clearParamsRef.current = clearParams;

    // Absorb URL params into local state, then immediately clean the URL.
    useEffect(() => {
        if (!paramTarget) return;

        setTarget(paramTarget);
        foundRef.current = false;
        clearParamsRef.current();
    }, [paramTarget]);

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
