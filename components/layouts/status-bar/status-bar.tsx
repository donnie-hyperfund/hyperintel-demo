'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { useSyncBarHeight } from '@/hooks/use-sync-bar-height';

export type StatusBarEntry = {
    id: string;
    icon?: ReactNode;
    content: ReactNode;
};

type StatusBarProps = {
    entries: StatusBarEntry[];
};

export function StatusBar({ entries }: StatusBarProps) {
    const barRef = useRef<HTMLDivElement>(null);

    useSyncBarHeight(barRef);

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
                        <div className="flex items-center justify-center gap-4 px-4 py-1.5 text-xs">
                            {entries.map((entry) => (
                                <div key={entry.id} className="flex items-center gap-1.5">
                                    {entry.icon}
                                    {entry.content}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
