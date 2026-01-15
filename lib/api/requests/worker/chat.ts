import { frontendEnv } from '@/lib/env';
import { getWorkerUrl } from '@/lib/api/requests/worker/common';
import { CHAT_EP, WORKERS } from '@/lib/constants/routes';
import { WORKERS_LOCAL_ENDPOINTS } from '@/lib/constants/routes';
import { SendChatActionDto } from '@/lib/schema/chat';


export const sendAction = async (
    data: SendChatActionDto,
    accessToken: string,
) => {
    if (
        !frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS &&
        frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE
    ) {
        let workerUrl = getWorkerUrl(
            WORKERS.Chat,
            CHAT_EP.ChatAction,
        );
        // if (
        //     process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL?.endsWith(
        //         'chat-ng-cerebras-hyper-fund-ai.vercel.app',
        //     )
        // ) {
        //     workerUrl = `https://action-item-experimental.${frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE}${ACTION_ITEM_EP.ChatAction}`;
        // }
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ChatAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};
