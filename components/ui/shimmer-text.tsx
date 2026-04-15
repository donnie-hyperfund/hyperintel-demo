'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type ShimmerTextProps = {
    children: ReactNode;
    className?: string;
    /** Animation duration in seconds */
    duration?: number;
};

export function ShimmerText({ children, className, duration = 2 }: ShimmerTextProps) {
    return (
        <span
            className={cn(
                'inline-block bg-clip-text',
                'bg-size-[200%_100%]',
                'animate-[shimmer_var(--shimmer-duration)_ease-in-out_infinite]',
                className,
            )}
            style={
                {
                    '--shimmer-duration': `${duration}s`,
                    backgroundImage:
                        'linear-gradient(90deg, currentColor 0%, currentColor 35%, color-mix(in oklch, currentColor, white 60%) 50%, currentColor 65%, currentColor 100%)',
                    WebkitTextFillColor: 'transparent',
                } as React.CSSProperties
            }
        >
            {children}
        </span>
    );
}
