'use client';

import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

type ControlButtonProps = React.ComponentProps<typeof IconButton>;

export function ControlButton({ className, ...props }: ControlButtonProps) {
    return <IconButton size="sm" rounded className={cn('hover:bg-neutral-300/7.5', className)} {...props} />;
}
