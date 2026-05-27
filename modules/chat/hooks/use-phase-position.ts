import { useFetchChatsInfinite } from '@/lib/api/client/hooks/use-chats';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function usePhasePosition() {
    const {
        projectId,
        state: { phaseIndex },
    } = useChatContext();

    const { data: chatPages } = useFetchChatsInfinite(projectId);
    const totalPhases = chatPages?.[0]?.pagination.total ?? 0;

    const isLatestPhase = typeof phaseIndex === 'number' && totalPhases > 0 && phaseIndex === totalPhases - 1;

    return { isLatestPhase };
}
