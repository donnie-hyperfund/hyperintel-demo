'use client';

import { ArrowUp, Loader2 } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { OptionRow } from './option-row';
import { OtherRow } from './other-row';
import { useDecisionFlow } from './use-decision-flow';

const SURFACE_CHROME = 'relative rounded-5 border border-neutral-700 shadow-lg shadow-black/15 bg-neutral-800';
const COMPOSER_GRADIENT: React.CSSProperties = {
    background: 'linear-gradient(to bottom, transparent 0px, var(--color-card) 2rem)',
};

export function DecisionPrompt() {
    const flow = useDecisionFlow();
    const flowRef = useRef(flow);
    flowRef.current = flow;
    const questionId = useId();
    const enabled = !!flow.active && !flow.isSubmitting;

    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (event.key === 'Escape') {
                // First Esc closes an open popover; only a follow-up Esc dismisses the prompt.
                const target = event.target as HTMLElement | null;
                if (target?.closest('[data-slot="popover-content"]')) return;
                event.preventDefault();
                flowRef.current.dismiss();
                return;
            }
            const active = document.activeElement as HTMLElement | null;
            const tag = active?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
            const digit = Number.parseInt(event.key, 10);
            if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
            event.preventDefault();
            flowRef.current.selectOptionByIndex(digit - 1);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [enabled]);

    if (!flow.active) return null;

    const otherIndex = flow.active.options.length + 1;
    const canSend = !flow.isSubmitting && flow.otherText.trim().length > 0;
    const isOtherSubmitting = !!flow.submission?.freeText;

    return (
        <div className="relative flex justify-center px-4">
            <div className="absolute inset-0 pointer-events-none" style={COMPOSER_GRADIENT} />
            <div className="w-full max-w-3xl relative z-10">
                <div className={cn(SURFACE_CHROME, 'p-4 sm:p-5')} role="group" aria-labelledby={questionId}>
                    <p id={questionId} className="text-base font-semibold leading-tight text-foreground">
                        {flow.active.question}
                    </p>
                    {flow.active.context && (
                        <p className="mt-3 text-xs leading-snug text-muted-foreground">{flow.active.context}</p>
                    )}

                    <div className="-mx-3 mt-5">
                        {flow.active.options.map((option, index) => (
                            <OptionRow
                                key={option.value}
                                number={index + 1}
                                option={option}
                                submission={flow.submission}
                                onSelect={flow.selectOption}
                            />
                        ))}
                        <OtherRow number={otherIndex} flow={flow} />
                    </div>

                    <div className="mt-4 flex items-center justify-end gap-2 border-t border-neutral-700 pt-4 sm:mt-5 sm:pt-5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={flow.dismiss}
                            disabled={flow.isSubmitting}
                        >
                            Dismiss
                        </Button>
                        <Button type="button" size="sm" onClick={flow.submitOther} disabled={!canSend}>
                            {isOtherSubmitting ? (
                                <Loader2 className="mr-1 size-3.5 animate-spin" />
                            ) : (
                                <ArrowUp className="mr-1 size-3.5" />
                            )}
                            Send
                        </Button>
                    </div>
                </div>
            </div>

            <span aria-live="polite" className="sr-only">
                {flow.isSubmitting ? 'Submitting your choice…' : ''}
            </span>
        </div>
    );
}
