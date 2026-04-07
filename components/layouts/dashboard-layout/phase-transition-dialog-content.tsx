'use client';

import { ArrowRight, Check, Loader2, SparklesIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useArtifact } from '@/modules/artifacts/providers/artifact-provider';

type Step = 1 | 2 | 3;

type PhaseTransitionDialogContentProps = {
    isSummarizing: boolean;
    summaryDocKey: string | null;
    summaryNewChatId: string | null;
    error: Error | null;
    onRetry: () => void;
    onGoToNextPhase: () => void;
};

const STEP_ADVANCE_DELAY = 400;

function deriveStep(props: {
    summaryNewChatId: string | null;
    isSummarizing: boolean;
    docProgress: number | null;
}): Step {
    if (props.summaryNewChatId || (props.docProgress !== null && props.docProgress >= 100)) return 3;
    if (props.isSummarizing && props.docProgress !== null) return 2;
    return 1;
}

const contentAnimation = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.2 },
};

const descriptions: Record<Step, string> = {
    1: 'Summarizing the current phase conversation...',
    2: 'Creating a completion brief for the next phase...',
    3: 'Your phase summary is ready. Continue to start a new conversation with context carried over.',
};

export function PhaseTransitionDialogContent({
    isSummarizing,
    summaryDocKey,
    summaryNewChatId,
    error,
    onRetry,
    onGoToNextPhase,
}: PhaseTransitionDialogContentProps) {
    const summaryArtifact = useArtifact(summaryDocKey ?? '', 1);
    const peakRef = useRef(0);
    peakRef.current = summaryDocKey ? Math.max(peakRef.current, summaryArtifact?.progress ?? 0) : 0;
    const docProgress = summaryDocKey ? peakRef.current : null;

    const targetStep = deriveStep({ isSummarizing, docProgress, summaryNewChatId });
    const [displayStep, setDisplayStep] = useState<Step>(1);

    // Auto-advance with micro-pause, clamped to +1 so each step is visible
    useEffect(() => {
        if (targetStep <= displayStep) return;
        const nextStep = Math.min(displayStep + 1, targetStep) as Step;
        const timer = setTimeout(() => setDisplayStep(nextStep), STEP_ADVANCE_DELAY);
        return () => clearTimeout(timer);
    }, [targetStep, displayStep]);

    // Reset on retry
    useEffect(() => {
        if (!isSummarizing && !summaryNewChatId && !error) {
            setDisplayStep(1);
        }
    }, [isSummarizing, summaryNewChatId, error]);

    const showError = !!error && !isSummarizing;

    return (
        <>
            <DialogHeader>
                <DialogTitle>{displayStep === 3 ? 'Summary ready' : 'Preparing next phase'}</DialogTitle>
                <DialogDescription>{descriptions[displayStep]}</DialogDescription>
            </DialogHeader>

            {showError ? (
                <motion.div
                    key="error"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-3 py-6"
                >
                    <p className="text-sm text-destructive text-center">Something went wrong. Please try again.</p>
                    <Button onClick={onRetry} variant="secondary" size="sm" className="gap-2">
                        Try again
                        <ArrowRight className="size-4" />
                    </Button>
                </motion.div>
            ) : (
                <motion.div layout className="flex flex-col items-center">
                    <AnimatePresence mode="wait">
                        {displayStep === 1 && (
                            <motion.div
                                key="summarizing"
                                {...contentAnimation}
                                className="flex flex-col items-center gap-4"
                            >
                                <div className="flex size-11 items-center justify-center rounded-full border border-border bg-background/40">
                                    <Loader2 className="size-5 text-primary animate-spin" />
                                </div>
                                <p className="text-sm text-muted-foreground">Summarizing conversation...</p>
                            </motion.div>
                        )}

                        {displayStep === 2 && (
                            <motion.div
                                key="brief"
                                {...contentAnimation}
                                className="flex flex-col items-center gap-4 w-full"
                            >
                                <div className="flex size-11 items-center justify-center rounded-full border border-border bg-background/40">
                                    <SparklesIcon className="size-5 text-primary animate-pulse" />
                                </div>
                                <div className="space-y-1 text-center">
                                    <p className="text-sm font-medium">Generating document</p>
                                    <p className="text-xs text-muted-foreground">Completion Brief</p>
                                </div>
                                <div className="w-full max-w-xs space-y-2">
                                    <Progress value={docProgress ?? 0} className="h-1.5" />
                                    <p className="text-xs tabular-nums text-muted-foreground text-center">
                                        {docProgress ?? 0}%
                                    </p>
                                </div>
                            </motion.div>
                        )}

                        {displayStep === 3 && (
                            <motion.div key="ready" {...contentAnimation} className="flex flex-col items-center gap-4">
                                <div className="flex size-11 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10">
                                    <Check className="size-5 text-green-500" />
                                </div>
                                <Button onClick={onGoToNextPhase} disabled={!summaryNewChatId} className="gap-2">
                                    {summaryNewChatId ? 'Go to next phase' : 'Finalizing...'}
                                    {summaryNewChatId ? (
                                        <ArrowRight className="size-4" />
                                    ) : (
                                        <Loader2 className="size-4 animate-spin" />
                                    )}
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            )}
        </>
    );
}
