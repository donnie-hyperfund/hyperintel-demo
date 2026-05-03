'use client';

import { cn } from '@/lib/utils';

export function ToolbarDivider({ className }: { className?: string }) {
    return <div className={cn('w-[0.5px] h-5 bg-neutral-600/75', className)} />;
}
