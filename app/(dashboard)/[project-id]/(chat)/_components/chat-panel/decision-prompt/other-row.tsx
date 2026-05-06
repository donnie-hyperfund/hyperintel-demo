'use client';

import { Loader2 } from 'lucide-react';
import { useId } from 'react';
import { AutoExpandingTextarea } from '@/components/ui/auto-expanding-textarea';
import { cn } from '@/lib/utils';
import type { DecisionFlow } from './use-decision-flow';

type Props = {
    number: number;
    flow: DecisionFlow;
};

export function OtherRow({ number, flow }: Props) {
    const id = useId();
    const isOtherSubmitting = !!flow.submission?.freeText;
    const isLockedByOption = flow.isSubmitting && !isOtherSubmitting;
    const isActive = flow.otherText.length > 0;

    return (
        <label
            htmlFor={id}
            className={cn(
                'flex items-baseline gap-3 rounded-md px-3 py-2 transition-colors',
                isLockedByOption ? 'cursor-not-allowed opacity-50' : 'cursor-text hover:bg-neutral-700',
                isActive && 'bg-neutral-700',
            )}
        >
            <span
                aria-hidden="true"
                className="flex w-4 shrink-0 items-center justify-center text-xs tabular-nums text-muted-foreground"
            >
                {isOtherSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : `${number}.`}
            </span>
            <AutoExpandingTextarea
                id={id}
                value={flow.otherText}
                onChange={(event) => flow.setOtherText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        flow.submitOther();
                    }
                }}
                placeholder="Type your own answer…"
                rows={1}
                maxLength={2000}
                disabled={isLockedByOption}
                minHeight={20}
                maxHeight={240}
                className="w-full flex-1 border-0 bg-transparent p-0 text-sm leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
            />
        </label>
    );
}
