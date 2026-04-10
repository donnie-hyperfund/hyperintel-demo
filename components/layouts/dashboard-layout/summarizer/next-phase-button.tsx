'use client';

import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { SummarizerOverlay } from './summarizer-overlay';

export function NextPhaseButton() {
    const { projectId, summarizeChat, cancelSummary, navigateToNewPhase, clearPendingPhaseTransition, state } =
        useChatContext<'phase'>();

    const { data: chatPages, mutate: revalidateChats } = useFetchChatsInfinite(projectId);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState(false);

    const totalPhases = chatPages?.[0]?.data.length ?? 0;

    const isLatestPhase =
        typeof state.phaseIndex === 'number' && totalPhases > 0 && state.phaseIndex === totalPhases - 1;

    const hasAssistantMessage = state.messages.some((m) => m.role === 'assistant');

    const canTransition = isLatestPhase && hasAssistantMessage && !state.isLoading;

    const isButtonVisible = canTransition && !state.isGenerating;

    const isLocked = dialogOpen && !state.error;

    const handleClick = useCallback(() => {
        setDialogOpen(true);
        summarizeChat();
    }, [summarizeChat]);

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

    // Cross-tab sync: open dialog when summary starts on another tab
    useEffect(() => {
        if (state.isSummarizing && !dialogOpen) {
            setDialogOpen(true);
        }
    }, [state.isSummarizing, dialogOpen]);

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

        setDialogOpen(true);
        summarizeChat();
    }, [
        state.pendingPhaseTransition,
        canTransition,
        isLatestPhase,
        hasAssistantMessage,
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
                summaryDocKey={state.summaryDocKey}
                summaryNewChatId={state.summaryNewChatId}
                summaryStatus={state.summaryStatus}
                error={state.error}
                onRetry={handleClick}
                onGoToNextPhase={handleGoToNextPhase}
                onCancel={handleCancel}
            />
        </>
    );
}
