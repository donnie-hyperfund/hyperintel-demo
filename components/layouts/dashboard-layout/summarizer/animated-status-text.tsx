'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ShimmerText } from '@/components/ui/shimmer-text';

export function AnimatedStatusText({ text, shimmer = true }: { text: string; shimmer?: boolean }) {
    return (
        <AnimatePresence mode="wait">
            <motion.p
                key={text}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{
                    opacity: { duration: 0.25, delay: 0.15 },
                    y: { duration: 0.25, delay: 0.15 },
                }}
                className="text-md text-center max-w-md text-muted-foreground"
            >
                {shimmer ? (
                    <ShimmerText duration={4} className="text-muted-foreground">
                        {text}
                    </ShimmerText>
                ) : (
                    text
                )}
            </motion.p>
        </AnimatePresence>
    );
}
