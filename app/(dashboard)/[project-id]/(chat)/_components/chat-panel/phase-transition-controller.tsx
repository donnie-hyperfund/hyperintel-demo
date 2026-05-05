'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { SummarizerOverlay } from '@/components/layouts/dashboard-layout/summarizer/summarizer-overlay';
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
import { toast } from '@/hooks/use-toast';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { usePhaseGate } from '@/modules/chat/hooks/use-phase-gate';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type CbGateDialog = 'none' | 'generate' | 'pending';

export function PhaseTransitionController() {
    const { projectId, summarizeChat, cancelSummary, clearPendingPhaseTransition, state } = useChatContext<'phase'>();
    const router = useRouter();

    const { mutate: revalidateChats } = useFetchChatsInfinite(projectId);
    const { isLatestPhase, hasAssistantMessage, canTransition, requestCbGeneration } = usePhaseGate();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState(false);
    const [cbGateDialog, setCbGateDialog] = useState<CbGateDialog>('none');

    const attemptTransition = useCallback((): boolean => {
        const cbStatus = state.completionBriefStatus;

        if (cbStatus === 'approved') {
            setDialogOpen(true);
            summarizeChat();
            return true;
        }

        if (cbStatus === 'proposed') {
            setCbGateDialog('pending');
            return false;
        }

        setCbGateDialog('generate');
        return false;
    }, [state.completionBriefStatus, summarizeChat]);

    const handleRetry = useCallback(() => {
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
        if (!pendingNavigation || dialogOpen || !state.summaryNewChatId) return;
        setPendingNavigation(false);
        revalidateChats();
        router.push(`/${projectId}/${state.summaryNewChatId}`, { scroll: false });
    }, [pendingNavigation, dialogOpen, projectId, revalidateChats, router, state.summaryNewChatId]);

    // Cross-tab sync: open/close overlay based on summarizing state
    useEffect(() => {
        if (state.isSummarizing && !dialogOpen) {
            setDialogOpen(true);
        } else if (!state.isSummarizing && dialogOpen && !state.summaryNewChatId) {
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
            <SummarizerOverlay
                open={dialogOpen}
                isSummarizing={state.isSummarizing}
                summaryNewChatId={state.summaryNewChatId}
                summaryStatus={state.summaryStatus}
                error={state.error}
                onRetry={handleRetry}
                onGoToNextPhase={handleGoToNextPhase}
                onCancel={handleCancel}
            />

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
