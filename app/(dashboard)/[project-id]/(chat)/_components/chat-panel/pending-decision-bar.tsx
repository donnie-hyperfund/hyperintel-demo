'use client';

import { ArrowUp, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { DECISION_OTHER_SENTINEL } from '@/lib/schema/stream';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

/**
 * Renders the first active `request_user_decision` card above the chat composer.
 * Width matches the composer (max-w-3xl, centered). The agent's turn is paused
 * until the user clicks an option or submits a free-text answer via "Other".
 */
export function PendingDecisionBar() {
    const { pendingDecisions, selectDecision } = useChatContext();
    const [submittingValue, setSubmittingValue] = useState<string | null>(null);
    const [otherMode, setOtherMode] = useState(false);
    const [otherText, setOtherText] = useState('');
    const otherTextareaRef = useRef<HTMLTextAreaElement>(null);

    const active = pendingDecisions[0];

    // Reset local UI state whenever a new pending card arrives.
    const activeId = active?.toolCallId ?? null;
    useEffect(() => {
        setSubmittingValue(null);
        setOtherMode(false);
        setOtherText('');
    }, [activeId]);

    useEffect(() => {
        if (otherMode) otherTextareaRef.current?.focus();
    }, [otherMode]);

    if (!active) return null;

    const onSelectOption = (value: string) => {
        if (submittingValue) return;
        setSubmittingValue(value);
        selectDecision(active.toolCallId, value);
    };

    const onSubmitOther = () => {
        const text = otherText.trim();
        if (!text || submittingValue) return;
        setSubmittingValue(DECISION_OTHER_SENTINEL);
        selectDecision(active.toolCallId, DECISION_OTHER_SENTINEL, text);
    };

    const disabled = submittingValue !== null;

    return (
        <div className="relative flex justify-center px-4 pb-3">
            <div
                className={cn(
                    'w-full max-w-3xl rounded-xl border border-border bg-card/95 backdrop-blur',
                    'shadow-sm px-4 py-3 space-y-3',
                    'animate-in fade-in slide-in-from-bottom-1 duration-150',
                )}
                role="group"
                aria-label="Assistant decision prompt"
            >
                {active.context && (
                    <p className="text-xs text-muted-foreground leading-snug">{active.context}</p>
                )}
                <p className="text-sm font-medium text-foreground leading-snug">{active.question}</p>

                {!otherMode && (
                    <>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {active.options.map((opt) => {
                                const isSubmittingThis = submittingValue === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => onSelectOption(opt.value)}
                                        disabled={disabled}
                                        className={cn(
                                            'group relative flex flex-col items-start gap-0.5 rounded-lg border border-border bg-background',
                                            'px-3 py-2 text-left transition-colors',
                                            'hover:border-primary/60 hover:bg-accent/40',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            'disabled:cursor-not-allowed disabled:opacity-60',
                                            isSubmittingThis && 'border-primary/60 bg-accent/40',
                                        )}
                                    >
                                        <span className="flex w-full items-center gap-2 text-sm font-medium text-foreground">
                                            {isSubmittingThis && <Loader2 className="size-3 animate-spin" />}
                                            <span className="flex-1 truncate">{opt.label}</span>
                                        </span>
                                        {opt.description && (
                                            <span className="text-xs font-normal text-muted-foreground leading-snug">
                                                {opt.description}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setOtherMode(true)}
                                disabled={disabled}
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                            >
                                <Pencil className="size-3 mr-1" />
                                Other — type your own
                            </Button>
                        </div>
                    </>
                )}

                {otherMode && (
                    <div className="space-y-2">
                        <Textarea
                            ref={otherTextareaRef}
                            value={otherText}
                            onChange={(e) => setOtherText(e.target.value)}
                            placeholder="Describe what you want instead…"
                            rows={2}
                            maxLength={2000}
                            disabled={disabled}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    onSubmitOther();
                                }
                                if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setOtherMode(false);
                                    setOtherText('');
                                }
                            }}
                            className="resize-none text-sm"
                        />
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted-foreground">
                                ⌘/Ctrl + Enter to submit · Esc to cancel
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setOtherMode(false);
                                        setOtherText('');
                                    }}
                                    disabled={disabled}
                                    className="h-7"
                                >
                                    <X className="size-3 mr-1" />
                                    Back
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={onSubmitOther}
                                    disabled={disabled || !otherText.trim()}
                                    className="h-7"
                                >
                                    {submittingValue === DECISION_OTHER_SENTINEL ? (
                                        <Loader2 className="size-3 mr-1 animate-spin" />
                                    ) : (
                                        <ArrowUp className="size-3 mr-1" />
                                    )}
                                    Send
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
