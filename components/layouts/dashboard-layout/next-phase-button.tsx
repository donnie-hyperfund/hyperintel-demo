'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useFetchArtifactsInfinite } from '@/lib/api/client/hooks/use-artifacts';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { getArtifactChatId, getArtifactVersion } from '@/modules/chat/providers/artifact-provider/utils';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function NextPhaseButton() {
    const { projectId, chatId, summarizeChat, navigateToNewPhase, state } = useChatContext();

    const { data: chatPages, mutate: revalidateChats } = useFetchChatsInfinite(projectId);
    const { data: artifactPages } = useFetchArtifactsInfinite(projectId, { limit: 20 });

    const [dialogOpen, setDialogOpen] = useState(false);

    const totalPhases = chatPages?.[0]?.data.length ?? 0;

    const isLatestPhase =
        typeof state.phaseIndex === 'number' && totalPhases > 0 && state.phaseIndex === totalPhases - 1;

    const hasAnyApprovedArtifacts = useMemo(() => {
        if (!artifactPages || !chatId) return false;
        return artifactPages.some((page) =>
            page.data.some(
                (artifact) =>
                    getArtifactChatId(artifact) === chatId &&
                    getArtifactVersion(artifact)?.status === 'approved' &&
                    getArtifactVersion(artifact)?.document_type !== 'Completion Brief',
            ),
        );
    }, [artifactPages, chatId]);

    const visible = isLatestPhase && hasAnyApprovedArtifacts && !state.isGenerating && !state.isLoading;

    const isSummaryReady = !!state.summaryNewChatId;

    const isLocked = state.isSummarizing || isSummaryReady;

    const handleClick = useCallback(() => {
        setDialogOpen(true);
        summarizeChat();
    }, [summarizeChat]);

    const handleGoToNextPhase = useCallback(() => {
        setDialogOpen(false);
        revalidateChats();
        navigateToNewPhase();
    }, [navigateToNewPhase, revalidateChats]);

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
                        <div className="flex items-center justify-center pt-4">
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
