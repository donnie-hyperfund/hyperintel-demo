'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export type ErrorReferenceItem = {
    label: string;
    value?: string | null;
};

type ErrorReferenceListProps = {
    items: ErrorReferenceItem[];
    className?: string;
    variant?: 'default' | 'compact';
};

function ErrorReferenceRow({
    label,
    value,
    variant,
}: {
    label: string;
    value: string;
    variant: 'default' | 'compact';
}) {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch {
            // Ignore clipboard failures to avoid turning support actions into new UI errors.
        }
    };

    return (
        <div
            className={cn(
                'flex items-center gap-3 border border-white/10 bg-black/20',
                variant === 'default' ? 'rounded-2xl px-4 py-3.5' : 'rounded-xl px-3 py-2.5',
            )}
        >
            <div className="min-w-0 flex-1">
                <p
                    className={cn(
                        'font-medium uppercase tracking-[0.12em] text-white/45',
                        variant === 'default' ? 'text-[11px]' : 'text-[10px]',
                    )}
                >
                    {label}
                </p>
                <code
                    className={cn(
                        'mt-1 block break-all font-mono text-white/86',
                        variant === 'default' ? 'text-sm leading-6' : 'text-[12px] leading-5',
                    )}
                    title={value}
                >
                    {value}
                </code>
            </div>
            <IconButton
                size="xs"
                aria-label={`Copy ${label}`}
                className={cn(
                    'shrink-0 text-white/55 hover:text-white',
                    variant === 'default' ? 'bg-white/4 hover:bg-white/8' : '',
                )}
                onClick={handleCopy}
            >
                {isCopied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
            </IconButton>
        </div>
    );
}

export function ErrorReferenceList({ items, className, variant = 'default' }: ErrorReferenceListProps) {
    const visibleItems = items.filter((item): item is { label: string; value: string } => !!item.value?.trim());

    if (visibleItems.length === 0) {
        return null;
    }

    return (
        <div className={cn('space-y-2', className)}>
            {visibleItems.map((item) => (
                <ErrorReferenceRow
                    key={`${item.label}-${item.value}`}
                    label={item.label}
                    value={item.value}
                    variant={variant}
                />
            ))}
        </div>
    );
}
