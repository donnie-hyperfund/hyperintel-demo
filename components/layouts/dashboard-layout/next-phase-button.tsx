'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function NextPhaseButton() {
    const { projectId, hasAnyApprovedArtifacts, summarizeChat, navigateToNewPhase, state } = useChatContext();

    const { data: chatPages } = useFetchChatsInfinite(projectId);

    const totalPhases = chatPages?.[0]?.pagination.total ?? 0;
    const isLatestPhase =
        typeof state.phaseIndex === 'number' && totalPhases > 0 && state.phaseIndex === totalPhases - 1;
    const [dialogOpen, setDialogOpen] = useState(false);

    const visible = isLatestPhase && hasAnyApprovedArtifacts && !state.isGenerating && !state.isLoading;
    const isSummaryReady = !!state.summaryNewChatId;
    const isLocked = state.isSummarizing || isSummaryReady;

    const handleClick = useCallback(() => {
        setDialogOpen(true);
        summarizeChat();
    }, [summarizeChat]);

    const handleGoToNextPhase = useCallback(() => {
        setDialogOpen(false);
        navigateToNewPhase();
    }, [navigateToNewPhase]);

    if (!visible) return null;

    return (
        <>
            <Button
                variant="secondary"
                size="sm"
                onClick={handleClick}
                disabled={state.isSummarizing}
                className="gap-1.5"
            >
                Next phase
                <ArrowRight className="size-3.5" />
            </Button>

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    if (!open && isLocked) return;
                    setDialogOpen(open);
                }}
            >
                <DialogContent
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
                        <div className="flex items-center justify-center py-4">
                            <Loader2 className="size-6 animate-spin text-muted-foreground" />
                        </div>
                    )}

                    {state.error && !state.isSummarizing && (
                        <p className="text-sm text-destructive text-center py-2">{state.error.message}</p>
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
