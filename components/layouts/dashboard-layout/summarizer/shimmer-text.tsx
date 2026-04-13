'use client';

import { AnimatePresence, motion } from 'motion/react';

const SHIMMER_GRADIENT =
    'linear-gradient(90deg, var(--color-muted-foreground) 0%, var(--color-muted-foreground) 40%, color-mix(in srgb, var(--color-foreground) 35%, var(--color-muted-foreground)) 50%, var(--color-muted-foreground) 60%, var(--color-muted-foreground) 100%)';

export function ShimmerText({ text, shimmer = true }: { text: string; shimmer?: boolean }) {
    return (
        <AnimatePresence mode="wait">
            <motion.p
                key={text}
                initial={{ opacity: 0, y: 4 }}
                animate={{
                    opacity: 1,
                    y: 0,
                    backgroundPositionX: shimmer ? ['100%', '-100%'] : '0%',
                }}
                exit={{ opacity: 0, y: -4 }}
                transition={{
                    opacity: { duration: 0.25, delay: 0.15 },
                    y: { duration: 0.25, delay: 0.15 },
                    backgroundPositionX: { duration: 2, repeat: Infinity, ease: 'linear' },
                }}
                className="text-md text-center max-w-md"
                style={{
                    backgroundImage: SHIMMER_GRADIENT,
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                }}
            >
                {text}
            </motion.p>
        </AnimatePresence>
    );
}
