import { useCallback } from 'react';
import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function usePhaseGate() {
    const {
        sendMessage,
        projectId,
        state: { phaseIndex, messages, isLoading, isGenerating },
    } = useChatContext();

    const { data: chatPages } = useFetchChatsInfinite(projectId);

    const totalPhases = chatPages?.[0]?.pagination.total ?? 0;

    const isLatestPhase = typeof phaseIndex === 'number' && totalPhases > 0 && phaseIndex === totalPhases - 1;

    const hasAssistantMessage = messages.some((message) => message.role === 'assistant');

    const canTransition = isLatestPhase && hasAssistantMessage && !isLoading;

    const requestCbGeneration = useCallback(() => {
        if (!isGenerating) {
            sendMessage('Please generate the Completion Brief for this phase.');
        }
    }, [sendMessage, isGenerating]);

    return {
        isLatestPhase,
        hasAssistantMessage,
        canTransition,
        requestCbGeneration,
    };
}
