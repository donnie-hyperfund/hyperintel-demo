'use client';

import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSyncHeightToCssVar } from '@/hooks/use-sync-height-to-css-var';
import { CSS_VARS } from '@/lib/css-vars';
import { cn } from '@/lib/utils';

export type StatusBarEntry = {
    id: string;
    icon?: ReactNode;
    content: ReactNode;
    onClick?: () => void;
};

type StatusBarProps = {
    entries: StatusBarEntry[];
    mode?: 'split' | 'rotate';
    autoRotateMs?: number;
};

const SWIPE_THRESHOLD = 30;
const WHEEL_COOLDOWN_MS = 200;

export function StatusBar({ entries, mode = 'split', autoRotateMs = 4000 }: StatusBarProps) {
    const barRef = useRef<HTMLDivElement>(null);

    useSyncHeightToCssVar(barRef, CSS_VARS.PROCESSING_BAR_HEIGHT);

    return (
        <div ref={barRef}>
            <AnimatePresence>
                {entries.length > 0 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden bg-neutral-975 border-b border-border z-50 relative"
                    >
                        {mode === 'rotate' && entries.length > 1 ? (
                            <RotatingEntries entries={entries} autoRotateMs={autoRotateMs} />
                        ) : (
                            <SplitEntries entries={entries} />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function SplitEntries({ entries }: { entries: StatusBarEntry[] }) {
    return (
        <div className="flex items-center justify-center gap-4 px-4 py-1.5 text-xs">
            {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
            ))}
        </div>
    );
}

function RotatingEntries({ entries, autoRotateMs }: { entries: StatusBarEntry[]; autoRotateMs: number }) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const wheelLockRef = useRef(0);
    const touchStartXRef = useRef<number | null>(null);
    const entriesCountRef = useRef(entries.length);
    entriesCountRef.current = entries.length;
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;

    const safeIndex = activeIndex % entries.length;
    const active = entries[safeIndex];

    useEffect(() => {
        if (paused || expanded || entries.length <= 1) return;
        const timeoutId = setTimeout(() => setActiveIndex((prev) => (prev + 1) % entries.length), autoRotateMs);
        return () => clearTimeout(timeoutId);
    }, [activeIndex, paused, expanded, entries.length, autoRotateMs]);

    const step = (direction: 1 | -1) => {
        setActiveIndex((prev) => (prev + direction + entries.length) % entries.length);
    };

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const handler = (event: WheelEvent) => {
            if (expandedRef.current || entriesCountRef.current <= 1) return;
            event.preventDefault();
            if (Math.abs(event.deltaY) < 4) return;
            const now = Date.now();
            if (now - wheelLockRef.current < WHEEL_COOLDOWN_MS) return;
            wheelLockRef.current = now;
            setActiveIndex(
                (prev) => (prev + (event.deltaY > 0 ? 1 : -1) + entriesCountRef.current) % entriesCountRef.current,
            );
        };
        element.addEventListener('wheel', handler, { passive: false });
        return () => element.removeEventListener('wheel', handler);
    }, []);

    const onTouchStart = (event: React.TouchEvent) => {
        if (expanded) return;
        touchStartXRef.current = event.touches[0]?.clientX ?? null;
    };

    const onTouchEnd = (event: React.TouchEvent) => {
        if (expanded) return;
        const startX = touchStartXRef.current;
        touchStartXRef.current = null;
        if (startX === null) return;
        const endX = event.changedTouches[0]?.clientX ?? startX;
        const deltaX = endX - startX;
        if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
        step(deltaX < 0 ? 1 : -1);
    };

    return (
        <motion.div
            ref={containerRef}
            layout
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="flex items-start justify-center gap-2 px-4 py-1.5 text-xs"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
        >
            <div className="flex flex-col items-center gap-1">
                {expanded ? (
                    entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
                ) : (
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={active.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.22, ease: 'easeOut' }}
                        >
                            <EntryRow entry={active} />
                        </motion.div>
                    </AnimatePresence>
                )}
            </div>
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                aria-label={expanded ? 'Collapse status bar' : 'Expand status bar'}
                className="p-0.5 rounded text-muted-foreground hover:bg-neutral-900 hover:text-foreground transition-colors cursor-pointer"
            >
                <ChevronDown className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
            </button>
        </motion.div>
    );
}

function EntryRow({ entry }: { entry: StatusBarEntry }) {
    if (!entry.onClick) {
        return (
            <div className="flex items-center gap-1.5">
                {entry.icon}
                {entry.content}
            </div>
        );
    }
    return (
        <button type="button" onClick={entry.onClick} className="flex items-center gap-1.5 cursor-pointer">
            {entry.icon}
            {entry.content}
        </button>
    );
}
