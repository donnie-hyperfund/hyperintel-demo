'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

const SHIMMER_SWEEP =
    'linear-gradient(90deg, transparent 0%, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%, transparent 100%)';

type PillProps = {
    label: string;
    icon: React.ReactNode;
    baseColor: string;
    /** Override the default shimmer sweep with a custom gradient. */
    gradient?: string;
    /** Key used to crossfade label/icon when they change without remounting the pill. */
    contentKey?: string;
    onClick: () => void;
    onDismiss?: () => void;
    className?: string;
};

export function Pill({ label, icon, baseColor, gradient, contentKey, onClick, onDismiss, className }: PillProps) {
    const handleDismiss = (event: React.SyntheticEvent) => {
        event.stopPropagation();
        onDismiss?.();
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={cn('flex justify-center', className)}
        >
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    'relative overflow-hidden rounded-full px-5 py-2.5 text-sm font-medium text-white/90 shadow-lg cursor-pointer',
                    'border border-white/10',
                    'transition-shadow hover:shadow-xl',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
                style={{
                    backgroundColor: baseColor,
                    backgroundImage: gradient ?? SHIMMER_SWEEP,
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 4s infinite linear',
                }}
            >
                <AnimatePresence mode="wait">
                    <motion.span
                        key={contentKey ?? 'static'}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-2"
                    >
                        {icon}
                        {label}
                        {onDismiss && (
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={handleDismiss}
                                onKeyDown={(event) => event.key === 'Enter' && handleDismiss(event)}
                                className="ml-1 rounded-full p-0.5 hover:bg-white/15 transition-colors"
                            >
                                <X className="size-3.5" />
                            </span>
                        )}
                    </motion.span>
                </AnimatePresence>
            </button>
        </motion.div>
    );
}
