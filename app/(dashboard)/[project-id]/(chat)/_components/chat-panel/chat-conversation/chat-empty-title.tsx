'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type ChatEmptyTitleProps = {
    title: string;
    subtitle: string;
    className?: string;
};

export const ChatEmptyTitle = ({ title, subtitle, className }: ChatEmptyTitleProps) => {
    return (
        <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className={cn('space-y-2 text-center', className)}
        >
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-neutral-100">{title}</h1>
            <p className="text-base text-muted-foreground leading-relaxed">{subtitle}</p>
        </motion.div>
    );
};
