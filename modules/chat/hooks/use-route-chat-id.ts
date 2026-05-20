import { useParams } from 'next/navigation';

type RouteParams = Record<string, string | string[] | undefined>;

export function useRouteChatId(): string | undefined {
    const params = useParams<RouteParams>();
    return typeof params.chatId === 'string' ? params.chatId : undefined;
}
