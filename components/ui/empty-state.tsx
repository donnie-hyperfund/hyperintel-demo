import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyStateProps = {
    icon?: LucideIcon;
    title: string;
    description?: string;
    error?: string;
    children?: React.ReactNode;
    className?: string;
};

export const EmptyState = ({ icon: Icon, title, description, error, children, className }: EmptyStateProps) => {
    return (
        <div className={cn('flex flex-col items-center justify-center gap-4 p-8 text-center', className)}>
            {Icon && (
                <div className="flex size-16 items-center justify-center rounded-5 bg-neutral-800/60">
                    <Icon className="size-6 opacity-75" strokeWidth={1.5} />
                </div>
            )}

            <div className="space-y-1.5">
                <h3 className="text-base font-medium text-neutral-200">{title}</h3>
                {description && <p className="max-w-xs text-sm text-neutral-500">{description}</p>}
                {error && <p className="max-w-xs text-sm text-red-400/80">{error}</p>}
            </div>

            {children && <div className="mt-2">{children}</div>}
        </div>
    );
};
