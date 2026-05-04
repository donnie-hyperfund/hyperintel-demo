'use client';

import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

type ToolbarProps = {
    children: React.ReactNode;
    className?: string;
    visible?: boolean;
};

export function Toolbar({ children, className, visible = true }: ToolbarProps) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className={cn(
                        'absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 p-1 rounded-full border bg-neutral-800/97.5 border-neutral-700/50 shadow-lg shadow-black/10 backdrop-blur-sm',
                        className,
                    )}
                >
                    {children}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
