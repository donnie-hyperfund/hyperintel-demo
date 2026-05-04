'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ShimmerText } from '@/components/ui/shimmer-text';

type AnimatedApprovalTextProps = {
    text: string;
    className?: string;
    shimmer?: boolean;
    shimmerDuration?: number;
    as?: 'p' | 'span';
};

function TextContent({
    text,
    shimmer,
    shimmerDuration,
}: Pick<AnimatedApprovalTextProps, 'text' | 'shimmer' | 'shimmerDuration'>) {
    if (!shimmer) return text;

    return (
        <ShimmerText duration={shimmerDuration} className="text-inherit">
            {text}
        </ShimmerText>
    );
}

export function AnimatedApprovalText({
    text,
    className,
    shimmer = true,
    shimmerDuration = 4,
    as = 'p',
}: AnimatedApprovalTextProps) {
    const motionProps = {
        key: text,
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4 },
        transition: {
            opacity: { duration: 0.25, delay: 0.12 },
            y: { duration: 0.25, delay: 0.12 },
        },
        className,
    };

    return (
        <AnimatePresence mode="wait">
            {as === 'span' ? (
                <motion.span {...motionProps}>
                    <TextContent text={text} shimmer={shimmer} shimmerDuration={shimmerDuration} />
                </motion.span>
            ) : (
                <motion.p {...motionProps}>
                    <TextContent text={text} shimmer={shimmer} shimmerDuration={shimmerDuration} />
                </motion.p>
            )}
        </AnimatePresence>
    );
}
