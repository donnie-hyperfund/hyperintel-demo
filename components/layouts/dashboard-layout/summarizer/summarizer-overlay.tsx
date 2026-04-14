'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { SummaryStatus } from '@/modules/chat/types';
import { AnimatedHeadline } from './animated-headline';
import { CancelSummaryButton } from './cancel-summary-button';
import { ShimmerText } from './shimmer-text';

type SummarizerOverlayProps = {
    open: boolean;
    isSummarizing: boolean;
    summaryNewChatId: string | null;
    summaryStatus: SummaryStatus | null;
    error: Error | null;
    onRetry: () => void;
    onGoToNextPhase: () => void;
    onCancel: () => void;
};

const STATUS_HEADLINES: Record<SummaryStatus, string> = {
    'generating-summary': 'Distilling your conversation',
    finalizing: 'Wrapping things up',
};

const STATUS_SUBTITLES: Record<SummaryStatus, string[]> = {
    'generating-summary': [
        'Reading through everything that was discussed...',
        'Identifying key themes and decisions...',
        'Extracting the most important takeaways...',
        'Piecing together the full picture...',
        'Almost done reading through the conversation...',
    ],
    finalizing: ['Setting up your next phase...'],
};

function useRotatingText(texts: string[], intervalMs: number, key: string | null): string {
    const [index, setIndex] = useState(0);
    const textsRef = useRef(texts);
    textsRef.current = texts;

    useEffect(() => {
        setIndex(0);
    }, [key]);

    useEffect(() => {
        if (textsRef.current.length <= 1) return;
        const timer = setInterval(() => {
            setIndex((prev) => (prev + 1) % textsRef.current.length);
        }, intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs, key]);

    return texts[index % texts.length];
}

function getStatusTitle(status: SummaryStatus | null, isDone: boolean): string {
    if (isDone) return 'Ready for the next phase';
    if (status) return STATUS_HEADLINES[status];
    return 'Preparing next phase';
}

export function SummarizerOverlay({
    open,
    isSummarizing,
    summaryNewChatId,
    summaryStatus,
    error,
    onRetry,
    onGoToNextPhase,
    onCancel,
}: SummarizerOverlayProps) {
    const [displayStatus, setDisplayStatus] = useState<SummaryStatus | null>(summaryStatus);
    const displayStatusRef = useRef(displayStatus);
    displayStatusRef.current = displayStatus;

    const isDone = !!summaryNewChatId;
    const showError = !!error && !isSummarizing;

    // Debounce status so each headline stays visible long enough
    useEffect(() => {
        if (!summaryStatus && !summaryNewChatId) {
            setDisplayStatus(null);
        } else if (summaryStatus && summaryStatus !== displayStatusRef.current) {
            const timer = setTimeout(() => setDisplayStatus(summaryStatus), 600);
            return () => clearTimeout(timer);
        }
    }, [summaryStatus, summaryNewChatId]);

    const title = getStatusTitle(displayStatus, isDone);
    const subtitleTexts = displayStatus ? STATUS_SUBTITLES[displayStatus] : ['Starting up...'];
    const rotatingSubtitle = useRotatingText(subtitleTexts, 8000, displayStatus);
    const subtitle = isDone ? null : rotatingSubtitle;

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
                    {isSummarizing && !isDone && <CancelSummaryButton onConfirm={onCancel} />}

                    <div className="flex flex-col items-center gap-4 px-6">
                        <AnimatedHeadline text={title} />

                        {subtitle && <ShimmerText text={subtitle} shimmer={!isDone} />}

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
            <span className="text-sm">{displayStatus ? STATUS_HEADLINES[displayStatus] + '...' : 'Preparing...'}</span>
        </motion.div>
    );
}
