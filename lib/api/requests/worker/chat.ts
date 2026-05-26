import { type EmptyResponseDto, type TypedResponse, typedFetch } from '@/lib/api/client/fetch';
import { getWorkerUrl, toFormData } from '@/lib/api/requests/worker/common';
import { CHAT_EP, WORKERS, WORKERS_LOCAL_ENDPOINTS } from '@/lib/constants/routes';
import { frontendEnv } from '@/lib/env';
import {
    ApproveArtifactActionDto,
    type AssociateUploadsDto,
    type ClearDraftsDto,
    type ConfirmUploadDto,
    type ConfirmUploadResponseDto,
    type DeleteArtifactDto,
    type ExportFormat,
    type PresignUploadDto,
    type PresignUploadResponseDto,
    RejectArtifactActionDto,
    RestoreArtifactActionDto,
    type RestoreArtifactResponseDto,
    type UploadArtifactResponseDto,
} from '@/lib/schema/artifact';
import {
    AbortActionDto,
    PhaseTransitionActionDto,
    type PhaseTransitionActionResponseDto,
    SendChatActionDto,
    type SendChatActionResponseDto,
    StartPendingPhaseActionDto,
} from '@/lib/schema/chat';

export const sendIntakeAction = (
    data: SendChatActionDto,
    accessToken: string,
): Promise<TypedResponse<SendChatActionResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.IntakeAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.IntakeAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const sendAction = (
    data: SendChatActionDto,
    accessToken: string,
): Promise<TypedResponse<SendChatActionResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ChatAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.ChatAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const abort = (data: AbortActionDto, accessToken: string): Promise<TypedResponse<EmptyResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.AbortAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.AbortAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const requestPhaseTransition = (
    data: PhaseTransitionActionDto,
    accessToken: string,
): Promise<TypedResponse<PhaseTransitionActionResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.PhaseTransitionAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.PhaseTransitionAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const startPendingPhase = (
    data: StartPendingPhaseActionDto,
    accessToken: string,
): Promise<TypedResponse<SendChatActionResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.StartPendingPhaseAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.StartPendingPhaseAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
};

export const approveArtifact = (
    data: ApproveArtifactActionDto,
    accessToken: string,
): Promise<TypedResponse<EmptyResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ApproveAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
            keepalive: true,
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.ApproveAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        keepalive: true,
    });
};

export const rejectArtifact = (
    data: RejectArtifactActionDto,
    accessToken: string,
): Promise<TypedResponse<EmptyResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.RejectAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
            keepalive: true,
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.RejectAction, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        keepalive: true,
    });
};

export const restoreArtifact = (
    data: RestoreArtifactActionDto,
    accessToken: string,
): Promise<TypedResponse<RestoreArtifactResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.RestoreAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
            keepalive: true,
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.RestoreAction, {
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
): Promise<TypedResponse<UploadArtifactResponseDto>> => {
    const body = toFormData(data);

    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.UploadAction);
        return typedFetch<UploadArtifactResponseDto>(workerUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body,
        });
    }
    return typedFetch<UploadArtifactResponseDto>(WORKERS_LOCAL_ENDPOINTS.UploadAction, {
        method: 'POST',
        body,
    });
};

export const presignUpload = (
    data: PresignUploadDto,
    accessToken: string,
): Promise<TypedResponse<PresignUploadResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.PresignAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.PresignAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const confirmUpload = (
    data: ConfirmUploadDto,
    accessToken: string,
): Promise<TypedResponse<ConfirmUploadResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ConfirmAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.ConfirmAction, {
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
export type PresignImageUploadResponseDto = { uploadUrl: string; fileId: string; storageKey: string };
export type ConfirmImageUploadResponseDto = { success: true; fileId: string };

export const presignImageUpload = (
    data: PresignImageUploadDto,
    accessToken: string,
): Promise<TypedResponse<PresignImageUploadResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ImagePresignAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.ImagePresignAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
};

export const confirmImageUpload = (
    data: ConfirmImageUploadDto,
    accessToken: string,
): Promise<TypedResponse<ConfirmImageUploadResponseDto>> => {
    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const workerUrl = getWorkerUrl(WORKERS.Chat, CHAT_EP.ImageConfirmAction);
        return typedFetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(data),
        });
    }
    return typedFetch(WORKERS_LOCAL_ENDPOINTS.ImageConfirmAction, {
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

export const exportArtifact = (
    artifactVersionId: string,
    accessToken: string,
    format: ExportFormat = 'docx',
): Promise<TypedResponse<EmptyResponseDto>> => {
    const params = new URLSearchParams({ artifactVersionId, format });

    if (!frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS && frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE) {
        const base = getWorkerUrl(WORKERS.Chat, CHAT_EP.ExportAction);
        return typedFetch(`${base}?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    }
    return typedFetch(`${WORKERS_LOCAL_ENDPOINTS.ExportAction}?${params}`);
};
