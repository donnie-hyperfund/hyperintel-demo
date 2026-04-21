import type { MessageMetadata } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

export function pickDisplaySafeMessageMetadata(metadata: unknown): MessageMetadata | undefined {
    if (!isRecord(metadata)) {
        return undefined;
    }

    const nextMetadata: MessageMetadata = {
        ...(readString(metadata.preset) ? { preset: metadata.preset as string } : {}),
        ...(isRecord(metadata.inference) ? { inference: metadata.inference } : {}),
        ...(isRecord(metadata.usage) ? { usage: metadata.usage as MessageMetadata['usage'] } : {}),
        ...(readString(metadata.error) ? { error: metadata.error as string } : {}),
        ...(readString(metadata.errorCode) ? { errorCode: metadata.errorCode as string } : {}),
        ...(readString(metadata.requestId) ? { requestId: metadata.requestId as string } : {}),
    };

    return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}
