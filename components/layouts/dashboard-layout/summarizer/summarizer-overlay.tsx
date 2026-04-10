'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useArtifact } from '@/modules/artifacts/providers/artifact-provider';
import type { SummaryStatus } from '@/modules/chat/types';
import { AnimatedHeadline } from './animated-headline';
import { CancelSummaryButton } from './cancel-summary-button';
import { ShimmerProgress } from './shimmer-progress';
import { ShimmerText } from './shimmer-text';
import { useEasedProgress } from '@/hooks/use-eased-progress';


type SummarizerOverlayProps = {
    open: boolean;
    isSummarizing: boolean;
    summaryDocKey: string | null;
    summaryNewChatId: string | null;
    summaryStatus: SummaryStatus | null;
    error: Error | null;
    onRetry: () => void;
    onGoToNextPhase: () => void;
    onCancel: () => void;
};


const STATUS_HEADLINES: Record<SummaryStatus, string> = {
    'generating-summary': 'Distilling your conversation',
    'creating-completion-brief': 'Drafting the Completion Brief',
    'creating-pecp': 'Preparing the PECP',
    'saving-document': 'Saving your documents',
    'finalizing': 'Wrapping things up',
};

const STATUS_SUBTITLES: Record<SummaryStatus, string> = {
    'generating-summary': 'Reading through everything that was discussed...',
    'creating-completion-brief': 'Capturing key decisions and outcomes...',
    'creating-pecp': 'Summarizing for PE stakeholders...',
    'saving-document': 'Persisting the generated artifacts...',
    'finalizing': 'Setting up your next phase...',
};

function getStatusText(status: SummaryStatus | null, isDone: boolean): { title: string; subtitle: string | null } {
    if (isDone) {
        return {
            title: 'Ready for the next phase',
            subtitle: null,
        };
    }
    if (status) {
        return {
            title: STATUS_HEADLINES[status],
            subtitle: STATUS_SUBTITLES[status],
        };
    }
    return {
        title: 'Preparing next phase',
        subtitle: 'Starting up...',
    };
}

export function SummarizerOverlay({
    open,
    isSummarizing,
    summaryDocKey,
    summaryNewChatId,
    summaryStatus,
    error,
    onRetry,
    onGoToNextPhase,
    onCancel,
}: SummarizerOverlayProps) {
    const [displayStatus, setDisplayStatus] = useState<SummaryStatus | null>(summaryStatus);
    const summaryArtifact = useArtifact(summaryDocKey ?? '', 1);
    const rawProgress = summaryDocKey ? (summaryArtifact?.progress ?? 0) : 0;
    const displayProgress = useEasedProgress(rawProgress, summaryDocKey);

    const isDone = !!summaryNewChatId;
    const showError = !!error && !isSummarizing;

    // Debounce status so each headline stays visible long enough
    useEffect(() => {
        if (!summaryStatus && !summaryNewChatId) {
            setDisplayStatus(null);
        }
        else if (summaryStatus && summaryStatus !== displayStatus) {
            const timer = setTimeout(() => setDisplayStatus(summaryStatus), 600);
            return () => clearTimeout(timer);
        }
    }, [summaryStatus, summaryNewChatId]); // eslint-disable-line react-hooks/exhaustive-deps

    const { title, subtitle } = getStatusText(displayStatus, isDone);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm"
                >
                    {/* Cancel button — top right */}
                    {isSummarizing && !isDone && (
                        <CancelSummaryButton onConfirm={onCancel} />
                    )}

                    <div className="flex flex-col items-center gap-4 px-6">
                        <AnimatedHeadline text={title} />

                        {subtitle && <ShimmerText text={subtitle} shimmer={!isDone} />}

                        <AnimatePresence>
                            {displayStatus === 'creating-completion-brief' && displayProgress > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, width: 0 }}
                                    animate={{ opacity: 1, width: '100%' }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="w-full max-w-xs mt-2"
                                >
                                    <ShimmerProgress value={displayProgress} />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <AnimatePresence>
                            {isDone && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.3, delay: 0.1 }}
                                    className="mt-6"
                                >
                                    <Button onClick={onGoToNextPhase} size="lg" className="gap-2">
                                        Continue to next phase
                                        <ArrowRight className="size-4" />
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="absolute bottom-12 left-0 right-0 flex justify-center px-6">
                        <AnimatePresence mode="wait">
                            <FooterContent
                                showError={showError}
                                isDone={isDone}
                                displayStatus={displayStatus}
                                onRetry={onRetry}
                            />
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}

        </AnimatePresence>
    );
}

type FooterContentProps = {
    showError: boolean;
    isDone: boolean;
    displayStatus: SummaryStatus | null;
    onRetry: () => void;
};

function FooterContent({ showError, isDone, displayStatus, onRetry }: FooterContentProps) {
    if (showError) {
        return (
            <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="flex flex-col items-center gap-3"
            >
                <p className="text-sm text-destructive">Something went wrong.</p>
                <Button onClick={onRetry} variant="secondary" size="sm" className="gap-2">
                    Try again
                    <ArrowRight className="size-4" />
                </Button>
            </motion.div>
        );
    }

    if (isDone) return null;

    return (
        <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 text-muted-foreground"
        >
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">
                {displayStatus ? STATUS_HEADLINES[displayStatus] + '...' : 'Preparing...'}
            </span>
        </motion.div>
    );
}