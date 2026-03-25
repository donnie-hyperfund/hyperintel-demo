'use client';

import { motion } from 'motion/react';

const dotVariants = {
    initial: { opacity: 0.3 },
    animate: { opacity: [0.3, 1, 0.3] },
};

const dotTransition = (delay: number) => ({
    duration: 1.2,
    repeat: Infinity,
    delay,
    ease: 'easeInOut' as const,
});

export function ThinkingDots() {
    return (
        <span className="inline-flex tracking-[0.15em]">
            {[0, 1, 2].map((i) => (
                <motion.span
                    key={i}
                    variants={dotVariants}
                    initial="initial"
                    animate="animate"
                    transition={dotTransition(i * 0.2)}
                >
                    .
                </motion.span>
            ))}
        </span>
    );
}
