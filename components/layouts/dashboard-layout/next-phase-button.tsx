'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { useFetchProjectArtifactsInfinite } from '@/lib/api/client/hooks/use-project-artifacts';
import { getLatestArtifactVersion, getLatestArtifactVersionChatId } from '@/modules/artifacts/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function NextPhaseButton() {
    const { projectId, chatId, summarizeChat, navigateToNewPhase, clearPendingPhaseTransition, state } =
        useChatContext<'phase'>();

    const { data: chatPages, mutate: revalidateChats } = useFetchChatsInfinite(projectId);
    const { data: artifactPages } = useFetchProjectArtifactsInfinite(projectId, { limit: 20 });

    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState(false);

    const totalPhases = chatPages?.[0]?.data.length ?? 0;

    const isLatestPhase =
        typeof state.phaseIndex === 'number' && totalPhases > 0 && state.phaseIndex === totalPhases - 1;

    const hasAnyApprovedArtifacts = useMemo(() => {
        if (!artifactPages || !chatId) return false;
        return artifactPages.some((page) =>
            page.data.some(
                (artifact) =>
                    getLatestArtifactVersionChatId(artifact) === chatId &&
                    getLatestArtifactVersion(artifact)?.status === 'approved' &&
                    getLatestArtifactVersion(artifact)?.document_type !== 'Completion Brief',
            ),
        );
    }, [artifactPages, chatId]);

    const canTransition = isLatestPhase && hasAnyApprovedArtifacts && !state.isLoading;

    const isButtonVisible = canTransition && !state.isGenerating;

    const isSummaryReady = !!state.summaryNewChatId;

    const isLocked = state.isSummarizing || isSummaryReady;

    const handleClick = useCallback(() => {
        setDialogOpen(true);
        summarizeChat();
    }, [summarizeChat]);

    const handleGoToNextPhase = useCallback(() => {
        setPendingNavigation(true);
        setDialogOpen(false);
    }, []);

    useEffect(() => {
        if (!pendingNavigation || dialogOpen) return;
        setPendingNavigation(false);
        revalidateChats();
        navigateToNewPhase();
    }, [pendingNavigation, dialogOpen, revalidateChats, navigateToNewPhase]);

    // React to chat-triggered phase transition (AI called generate_summary)
    useEffect(() => {
        if (!state.pendingPhaseTransition) return;
        clearPendingPhaseTransition();

        if (!canTransition) {
            const reasons: string[] = [];
            if (!isLatestPhase) reasons.push('You are not on the latest phase.');
            if (!hasAnyApprovedArtifacts) reasons.push('You have no approved artifacts.');
            if (state.isLoading) reasons.push('Wait for the chat to finish responding.');
            toast({
                title: 'Cannot transition to next phase.',
                description: reasons.join('\n'),
                variant: 'destructive',
            });
            return;
        }

        setDialogOpen(true);
        summarizeChat();
    }, [
        state.pendingPhaseTransition,
        canTransition,
        isLatestPhase,
        hasAnyApprovedArtifacts,
        state.isLoading,
        clearPendingPhaseTransition,
        summarizeChat,
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
                    Start next phase
                    <ArrowRight className="size-3.5" />
                </Button>
            )}

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    if (!open && isLocked) return;
                    setDialogOpen(open);
                }}
            >
                <DialogContent
                    className="outline-none"
                    showCloseButton={!isLocked}
                    onPointerDownOutside={(e) => {
                        if (isLocked) e.preventDefault();
                    }}
                    onEscapeKeyDown={(e) => {
                        if (isLocked) e.preventDefault();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>{isSummaryReady ? 'Summary ready' : 'Preparing next phase'}</DialogTitle>
                        <DialogDescription>
                            {isSummaryReady
                                ? 'Your phase summary is ready. Continue to the next phase to start a new conversation with the context carried over.'
                                : 'We\u2019re generating a summary of the current phase. Once it\u2019s ready, you\u2019ll be able to continue to the next phase with full context.'}
                        </DialogDescription>
                    </DialogHeader>

                    {state.isSummarizing && (
                        <div className="flex items-center justify-center pt-4">
                            <Loader2 className="size-6 animate-spin text-muted-foreground" />
                        </div>
                    )}

                    {state.error && !state.isSummarizing && (
                        <div className="flex flex-col items-center justify-center gap-2">
                            <p className="text-sm text-destructive text-center py-2">
                                Something went wrong. Please try again.
                            </p>
                            <Button onClick={handleClick} className="gap-2 ml-auto">
                                Try again
                                <ArrowRight className="size-4" />
                            </Button>
                        </div>
                    )}

                    {isSummaryReady && (
                        <DialogFooter>
                            <Button onClick={handleGoToNextPhase} className="gap-2">
                                Go to next phase
                                <ArrowRight className="size-4" />
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
