'use client';

import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { usePhaseGate } from '@/modules/chat/hooks/use-phase-gate';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { getContextLevel, getContextPercent } from '@/modules/chat/utils';
import { SummarizerOverlay } from './summarizer-overlay';

type CbGateDialog = 'none' | 'generate' | 'pending';

export function NextPhaseButton() {
    const { projectId, summarizeChat, cancelSummary, navigateToNewPhase, clearPendingPhaseTransition, state } =
        useChatContext<'phase'>();

    const { mutate: revalidateChats } = useFetchChatsInfinite(projectId);
    const { isLatestPhase, hasAssistantMessage, canTransition, requestCbGeneration } = usePhaseGate();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState(false);
    const [cbGateDialog, setCbGateDialog] = useState<CbGateDialog>('none');

    const pillHandlesReady =
        getContextLevel(getContextPercent(state.tokenUsage)) !== 'normal' &&
        (state.completionBriefStatus === 'approved' || state.completionBriefStatus === 'proposed');

    const isButtonVisible = canTransition && !state.isGenerating && !pillHandlesReady;

    /**
     * Attempt to transition — checks CB gate first.
     * Returns true if summarization was started, false if gated.
     */
    const attemptTransition = useCallback((): boolean => {
        const cbStatus = state.completionBriefStatus;

        // State C: CB approved → proceed to summarizer
        if (cbStatus === 'approved') {
            setDialogOpen(true);
            summarizeChat();
            return true;
        }

        // State B: CB exists but not approved
        if (cbStatus === 'proposed') {
            setCbGateDialog('pending');
            return false;
        }

        // State A: No CB exists
        setCbGateDialog('generate');
        return false;
    }, [state.completionBriefStatus, summarizeChat]);

    const handleClick = useCallback(() => {
        attemptTransition();
    }, [attemptTransition]);

    const handleGenerateCb = useCallback(() => {
        setCbGateDialog('none');
        requestCbGeneration();
    }, [requestCbGeneration]);

    const handleGoToNextPhase = useCallback(() => {
        setPendingNavigation(true);
        setDialogOpen(false);
    }, []);

    const handleCancel = useCallback(() => {
        cancelSummary();
        setDialogOpen(false);
    }, [cancelSummary]);

    useEffect(() => {
        if (!pendingNavigation || dialogOpen) return;
        setPendingNavigation(false);
        revalidateChats();
        navigateToNewPhase();
    }, [pendingNavigation, dialogOpen, revalidateChats, navigateToNewPhase]);

    // Cross-tab sync: open/close dialog based on summarizing state
    useEffect(() => {
        if (state.isSummarizing && !dialogOpen) {
            setDialogOpen(true);
        } else if (!state.isSummarizing && dialogOpen && !state.summaryNewChatId) {
            // Summary was cancelled/errored on another tab — close the overlay
            setDialogOpen(false);
        }
    }, [state.isSummarizing, state.summaryNewChatId, dialogOpen]);

    // React to chat-triggered phase transition (AI called generate_summary)
    useEffect(() => {
        if (!state.pendingPhaseTransition) return;
        clearPendingPhaseTransition();

        if (!canTransition) {
            const reasons: string[] = [];
            if (!isLatestPhase) reasons.push('You are not on the latest phase.');
            if (!hasAssistantMessage) reasons.push('No conversation has taken place yet.');
            if (state.isLoading) reasons.push('Wait for the chat to finish responding.');
            toast({
                title: 'Cannot transition to next phase.',
                description: reasons.join('\n'),
                variant: 'destructive',
            });
            return;
        }

        // Apply the same CB gate for AI-triggered transitions
        attemptTransition();
    }, [
        state.pendingPhaseTransition,
        canTransition,
        isLatestPhase,
        hasAssistantMessage,
        state.isLoading,
        clearPendingPhaseTransition,
        attemptTransition,
    ]);

    return (
        <>
            {isButtonVisible && (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleClick}
                    disabled={state.isSummarizing}
                    className="gap-1.5"
                >
                    {/* Mobile */}
                    <span className="md:hidden">Next phase</span>
                    {/* Desktop */}
                    <span className="hidden md:inline">Start next phase</span>
                    <ArrowRight className="size-3.5" />
                </Button>
            )}

            <SummarizerOverlay
                open={dialogOpen}
                isSummarizing={state.isSummarizing}
                summaryNewChatId={state.summaryNewChatId}
                summaryStatus={state.summaryStatus}
                error={state.error}
                onRetry={handleClick}
                onGoToNextPhase={handleGoToNextPhase}
                onCancel={handleCancel}
            />

            {/* CB Gate: No Completion Brief exists */}
            <AlertDialog open={cbGateDialog === 'generate'} onOpenChange={() => setCbGateDialog('none')}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Completion Brief Required</AlertDialogTitle>
                        <AlertDialogDescription>
                            A Completion Brief must be generated and approved before moving to the next phase. Would you
                            like to generate one now?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleGenerateCb}>Generate</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* CB Gate: Completion Brief pending approval */}
            <AlertDialog open={cbGateDialog === 'pending'} onOpenChange={() => setCbGateDialog('none')}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Approval Required</AlertDialogTitle>
                        <AlertDialogDescription>
                            A Completion Brief has been generated but needs your approval. Please review and approve it
                            before proceeding to the next phase.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction>OK</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
