import type { PublicErrorCode } from '@/common/ai';
import type { MessageErrorMetadata, MessageMetadata } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

const KNOWN_CODES = new Set<PublicErrorCode>([
    'RATE_LIMITED',
    'SERVICE_OVERLOADED',
    'SERVICE_UNAVAILABLE',
    'NETWORK_ERROR',
    'CONTEXT_TOO_LONG',
    'CONTENT_POLICY',
    'MODEL_UNAVAILABLE',
    'INVALID_REQUEST',
    'INCOMPLETE_RESPONSE',
    'OUT_OF_FUNDS',
    'UNKNOWN',
]);

function pickErrorMetadata(value: unknown): MessageErrorMetadata | undefined {
    if (!isRecord(value)) return undefined;
    const code =
        typeof value.code === 'string' && KNOWN_CODES.has(value.code as PublicErrorCode)
            ? (value.code as PublicErrorCode)
            : undefined;
    if (!code) return undefined;
    const retryable = typeof value.retryable === 'boolean' ? value.retryable : false;
    return {
        code,
        retryable,
        ...(readString(value.referenceId) && { referenceId: value.referenceId as string }),
        ...(readString(value.detail) && { detail: value.detail as string }),
    };
}

export function pickDisplaySafeMessageMetadata(metadata: unknown): MessageMetadata | undefined {
    if (!isRecord(metadata)) return undefined;

    const error = pickErrorMetadata(metadata.error);

    const nextMetadata: MessageMetadata = {
        ...(readString(metadata.preset) && { preset: metadata.preset as string }),
        ...(isRecord(metadata.inference) && { inference: metadata.inference }),
        ...(isRecord(metadata.usage) && { usage: metadata.usage as MessageMetadata['usage'] }),
        ...(error && { error }),
    };

    return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}
