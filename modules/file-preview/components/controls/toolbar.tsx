'use client';

import { cn } from '@/lib/utils';

type ToolbarProps = {
    children: React.ReactNode;
    className?: string;
};

export function Toolbar({ children, className }: ToolbarProps) {
    return (
        <div
            className={cn(
                'absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 p-1 rounded-full border bg-neutral-800/97.5 border-neutral-700/50 shadow-lg shadow-black/10 backdrop-blur-sm',
                className,
            )}
        >
            {children}
        </div>
    );
}
