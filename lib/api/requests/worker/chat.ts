import { getWorkerUrl, toFormData } from '@/lib/api/requests/worker/common';
import { CHAT_EP, WORKERS, WORKERS_LOCAL_ENDPOINTS } from '@/lib/constants/routes';
import { frontendEnv } from '@/lib/env';
import { ApproveArtifactActionDto, RejectArtifactActionDto } from '@/lib/schema/artifact';
import { SendChatActionDto, SummarizeActionDto } from '@/lib/schema/chat';

export const sendAction = (data: SendChatActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ChatAction);
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

export const summarize = (data: SummarizeActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.SummarizeAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.SummarizeAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const approveArtifact = (data: ApproveArtifactActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ApproveAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ApproveAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const rejectArtifact = (data: RejectArtifactActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.RejectAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.RejectAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const uploadArtifact = (
    data: { file: File; projectId: string; chatId: string | null; title?: string },
    accessToken: string,
) => {
    const body = toFormData(data);

    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.UploadAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body,
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.UploadAction, {
        method: 'POST',
        body,
    });
};
