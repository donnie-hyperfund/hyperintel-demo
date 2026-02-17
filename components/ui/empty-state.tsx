import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const emptyStateVariants = cva('flex flex-col items-center justify-center text-center', {
    variants: {
        size: {
            default: 'gap-4 p-8',
            sm: 'gap-2 p-4',
        },
    },
    defaultVariants: {
        size: 'default',
    },
});

const iconWrapperVariants = cva('flex items-center justify-center bg-neutral-800/60', {
    variants: {
        size: {
            default: 'size-16 rounded-5',
            sm: 'size-10 rounded-3',
        },
    },
    defaultVariants: {
        size: 'default',
    },
});

const iconVariants = cva('opacity-75', {
    variants: {
        size: {
            default: 'size-6',
            sm: 'size-4',
        },
    },
    defaultVariants: {
        size: 'default',
    },
});

const titleVariants = cva('font-medium text-neutral-200', {
    variants: {
        size: {
            default: 'text-base',
            sm: 'text-sm',
        },
    },
    defaultVariants: {
        size: 'default',
    },
});

const descriptionVariants = cva('text-neutral-500', {
    variants: {
        size: {
            default: 'max-w-xs text-sm',
            sm: 'text-xs',
        },
    },
    defaultVariants: {
        size: 'default',
    },
});

type EmptyStateProps = VariantProps<typeof emptyStateVariants> & {
    icon?: LucideIcon;
    title: string;
    description?: string;
    error?: string;
    children?: React.ReactNode;
    className?: string;
};

export const EmptyState = ({ icon: Icon, title, description, error, children, size, className }: EmptyStateProps) => {
    return (
        <div className={cn(emptyStateVariants({ size }), className)}>
            {Icon && (
                <div className={iconWrapperVariants({ size })}>
                    <Icon className={iconVariants({ size })} strokeWidth={1.5} />
                </div>
            )}

            <div className={size === 'sm' ? 'space-y-0.5' : 'space-y-1.5'}>
                <h3 className={titleVariants({ size })}>{title}</h3>
                {description && <p className={descriptionVariants({ size })}>{description}</p>}
                {error && <p className="max-w-xs text-sm text-red-400/80">{error}</p>}
            </div>

            {children && <div className="mt-2">{children}</div>}
        </div>
    );
};
