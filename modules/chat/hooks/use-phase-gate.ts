import { useCallback } from 'react';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { usePhasePosition } from './use-phase-position';

export function usePhaseGate() {
    const {
        sendMessage,
        state: { messages, isLoading, isGenerating },
    } = useChatContext();

    const { isLatestPhase } = usePhasePosition();

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
