'use client';

import { motion } from 'motion/react';

export function ShimmerProgress({ value }: { value: number }) {
    return (
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-primary/10">
            <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/80"
                initial={{ width: '0%' }}
                animate={{ width: `${value}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
            />
            <motion.div
                className="absolute inset-y-0 w-1/3 rounded-full"
                style={{
                    background: 'linear-gradient(90deg, transparent, rgba(74,222,128,0.15), transparent)',
                }}
                animate={{ left: ['-33%', '100%'] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            />
        </div>
    );
}
