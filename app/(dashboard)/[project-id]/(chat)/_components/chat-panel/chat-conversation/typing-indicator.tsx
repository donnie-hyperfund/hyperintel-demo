'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

const dotVariants = {
    initial: { y: 0, scale: 1, opacity: 0.4 },
    animate: {
        y: [0, -1, 0],
        scale: [1, 1.1, 1],
    },
};

const dotTransition = (delay: number) => ({
    duration: 0.6,
    repeat: Infinity,
    repeatDelay: 0.2,
    delay,
    ease: 'easeInOut' as const,
});

type TypingIndicatorProps = {
    className?: string;
};

export const TypingIndicator = ({ className }: TypingIndicatorProps) => {
    return (
        <div className={cn('flex items-center gap-2.5', className)}>
            {[0, 1, 2].map((i) => (
                <motion.span
                    key={i}
                    className="w-1.75 h-1.75 bg-neutral-300 rounded-full"
                    variants={dotVariants}
                    initial="initial"
                    animate="animate"
                    transition={dotTransition(i * 0.15)}
                />
            ))}
        </div>
    );
};
