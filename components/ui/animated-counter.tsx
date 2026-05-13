'use client';

import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';

type AnimatedCounterProps = {
    value: number;
    format: (value: number) => string;
    duration?: number;
};

export function AnimatedCounter({ value, format, duration = 0.5 }: AnimatedCounterProps) {
    const motionValue = useMotionValue(value);
    const display = useTransform(motionValue, (current) => format(Math.round(current)));

    useEffect(() => {
        const controls = animate(motionValue, value, { duration, ease: 'easeOut' });
        return () => controls.stop();
    }, [motionValue, value, duration]);

    return <motion.span>{display}</motion.span>;
}
