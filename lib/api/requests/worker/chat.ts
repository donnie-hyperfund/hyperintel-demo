import { getWorkerUrl, toFormData } from '@/lib/api/requests/worker/common';
import { CHAT_EP, WORKERS, WORKERS_LOCAL_ENDPOINTS } from '@/lib/constants/routes';
import { frontendEnv } from '@/lib/env';
import {
    ApproveArtifactActionDto,
    type AssociateUploadsDto,
    type ClearDraftsDto,
    type ConfirmUploadDto,
    type DeleteArtifactDto,
    type ExportFormat,
    type PresignUploadDto,
    RejectArtifactActionDto,
} from '@/lib/schema/artifact';
import { AbortActionDto, SendChatActionDto, SummarizeActionDto } from '@/lib/schema/chat';

export const sendIntakeAction = (data: SendChatActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.IntakeAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.IntakeAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const sendAction = (data: SendChatActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ChatAction);
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

export const abort = (data: AbortActionDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.AbortAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.AbortAction, {
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
            keepalive: true,
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ApproveAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        keepalive: true,
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
            keepalive: true,
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.RejectAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        keepalive: true,
    });
};

export const uploadArtifact = (
    data: {
        file: File;
        projectId?: string | null;
        chatId?: string | null;
        title?: string;
        clientEntryId?: string;
        source?: 'chat-input' | 'project-resources';
    },
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

export const presignUpload = (data: PresignUploadDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.PresignAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.PresignAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const confirmUpload = (data: ConfirmUploadDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ConfirmAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ConfirmAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

// ── Image serving ──

/**
 * Build the same-origin URL to serve a chat message image.
 * Browser-driven requests like `<img>` tags cannot attach our worker auth header,
 * so image rendering must go through the Next.js gateway route.
 */
export function getImageUrl(fileId: string): string {
    return `${WORKERS_LOCAL_ENDPOINTS.ImageServe}/${fileId}`;
}

/**
 * Build the same-origin URL to serve an artifact image reference.
 * Like chat images, this must stay on the app origin so auth cookies are included.
 */
export function getArtifactImageUrl(key: string): string {
    return `${WORKERS_LOCAL_ENDPOINTS.ArtifactImageServe}/${key}`;
}

// ── Image upload (chat message attachments) ──

export type PresignImageUploadDto = { filename: string; fileSize: number; chatId?: string };
export type ConfirmImageUploadDto = { fileId: string };

export const presignImageUpload = (data: PresignImageUploadDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ImagePresignAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ImagePresignAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const confirmImageUpload = (data: ConfirmImageUploadDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ImageConfirmAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ImageConfirmAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const associateUploads = (data: AssociateUploadsDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.AssociateAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.AssociateAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const clearDrafts = (data: ClearDraftsDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ClearDraftsAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.ClearDraftsAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const deleteArtifact = (data: DeleteArtifactDto, accessToken: string) => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.DeleteAction);
        return fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return fetch(WORKERS_LOCAL_ENDPOINTS.DeleteAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const exportArtifact = (artifactVersionId: string, accessToken: string, format: ExportFormat = 'docx') => {
    const params = new URLSearchParams({ artifactVersionId, format });

    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const base = getWorkerUrl(WORKERS.Chat, CHAT_EP.ExportAction);
        return fetch(`${base}?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    }
    return fetch(`${WORKERS_LOCAL_ENDPOINTS.ExportAction}?${params}`);
};
