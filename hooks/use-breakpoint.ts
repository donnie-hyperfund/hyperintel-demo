import { useEffect, useState } from 'react';

const BREAKPOINTS = {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536,
} as const;

type BreakpointName = keyof typeof BREAKPOINTS;

type BreakpointState = {
    breakpoint: BreakpointName | 'base';
    width: number;
};

type UseBreakpointOptions = {
    /** When true, reads window.innerWidth for the initial value. Only use in client-only components. */
    eager?: boolean;
};

function resolve(width: number): BreakpointName | 'base' {
    if (width >= BREAKPOINTS['2xl']) return '2xl';
    if (width >= BREAKPOINTS.xl) return 'xl';
    if (width >= BREAKPOINTS.lg) return 'lg';
    if (width >= BREAKPOINTS.md) return 'md';
    if (width >= BREAKPOINTS.sm) return 'sm';
    return 'base';
}

export function useBreakpoint({ eager = false }: UseBreakpointOptions = {}): BreakpointState {
    const [state, setState] = useState<BreakpointState>(() => {
        if (eager && typeof window !== 'undefined') {
            const w = window.innerWidth;
            return { breakpoint: resolve(w), width: w };
        }
        return { breakpoint: 'base', width: 0 };
    });

    useEffect(() => {
        const update = () => {
            const w = window.innerWidth;
            setState({ breakpoint: resolve(w), width: w });
        };
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    return state;
}

const BREAKPOINT_ORDER: ReadonlyArray<BreakpointName | 'base'> = ['base', 'sm', 'md', 'lg', 'xl', '2xl'];

export function isAboveBreakpoint(current: BreakpointName | 'base', threshold: BreakpointName): boolean {
    return BREAKPOINT_ORDER.indexOf(current) >= BREAKPOINT_ORDER.indexOf(threshold);
}
