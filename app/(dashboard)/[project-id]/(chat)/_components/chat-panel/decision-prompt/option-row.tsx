'use client';

import { Info, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { DecisionOption } from '@/lib/schema/stream';
import { cn } from '@/lib/utils';
import type { DecisionSubmission } from '@/modules/chat/hooks/use-stream';

type Props = {
    number: number;
    option: DecisionOption;
    submission: DecisionSubmission | undefined;
    onSelect: (value: string) => void;
};

export function OptionRow({ number, option, submission, onSelect }: Props) {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const isThisSubmitting = submission?.value === option.value && !submission.freeText;
    const isDisabled = !!submission;
    const isDimmed = isDisabled && !isThisSubmitting;

    const handleSelect = () => {
        if (isDisabled) return;
        onSelect(option.value);
    };

    return (
        <div
            role="button"
            tabIndex={isDisabled ? -1 : 0}
            aria-disabled={isDisabled}
            aria-busy={isThisSubmitting}
            onClick={handleSelect}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelect();
                }
            }}
            className={cn(
                'flex min-h-9 items-center gap-3 rounded-md px-3 py-1.5 outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring',
                isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-neutral-700',
                isThisSubmitting && 'bg-neutral-700',
                isDimmed && 'opacity-50',
            )}
        >
            <span
                aria-hidden="true"
                className="flex w-4 shrink-0 items-center justify-center text-xs tabular-nums text-muted-foreground"
            >
                {isThisSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : `${number}.`}
            </span>
            <span className="text-sm font-medium text-foreground">{option.label}</span>
            {option.description && (
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            aria-label={`More about: ${option.label}`}
                            disabled={isDisabled}
                            onClick={(event) => event.stopPropagation()}
                            className={cn(
                                'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md',
                                'text-muted-foreground transition-colors',
                                'hover:bg-neutral-600 hover:text-foreground',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                'disabled:cursor-not-allowed disabled:hover:bg-transparent',
                            )}
                        >
                            <Info className="size-3.5" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        side="top"
                        align="start"
                        sideOffset={8}
                        collisionPadding={16}
                        className="max-w-xs text-xs leading-relaxed text-muted-foreground"
                    >
                        {option.description}
                    </PopoverContent>
                </Popover>
            )}
        </div>
    );
}
