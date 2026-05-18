/**
 * Bridges `ErrorClassification` from the agent runner to the shapes the worker
 * persists and logs. No user copy lives here — presentation is in `lib/errors`.
 */

import { PublicError } from '@common/common/error.helpers';
import { classificationFromKind, type ErrorClassification, type PublicErrorCode } from '@/common/ai';
import { classifyErrorFallback, serializeException } from '@/common/ai/utils';

// ============================================================================
// TYPES
// ============================================================================

/** Persisted in `ChatMessageEntity.metadata` and sent over WS. Never contains prose or raw text. */
export type StoredErrorMetadata = {
    code: PublicErrorCode;
    retryable: boolean;
    kind?: ErrorClassification['kind'];
    referenceId?: string;
};

/** `errorDetail` carries raw provider/internal text — logs only, never a client. */
export type WorkerErrorLogContext = {
    stage: string;
    code: PublicErrorCode;
    retryable: boolean;
    kind?: ErrorClassification['kind'];
    referenceId?: string;
    chatId?: string;
    agentMessageId?: string;
    errorDetail?: string;
};

// ============================================================================
// CLASSIFICATION
// ============================================================================

/** For errors thrown inside the worker (not via the agent runner). */
export function classifyWorkerError(error: unknown): ErrorClassification {
    if (error instanceof PublicError) {
        return publicErrorToClassification(error);
    }
    return classificationFromKind(classifyErrorFallback(error));
}

function publicErrorToClassification(error: PublicError): ErrorClassification {
    const fromCode = mapPublicErrorCode(error.code);
    if (fromCode) return fromCode;
    // Unknown app-level code — delegate to HTTP status.
    const kind = classifyErrorFallback(error);
    return classificationFromKind(kind);
}

function mapPublicErrorCode(ourCode: string): ErrorClassification | undefined {
    switch (ourCode) {
        case 'UNAUTHORIZED':
        case 'FORBIDDEN':
            return { code: 'SERVICE_UNAVAILABLE', retryable: false };
        case 'BAD_REQUEST':
            return { code: 'INVALID_REQUEST', retryable: false };
        case 'NOT_FOUND':
            return { code: 'MODEL_UNAVAILABLE', retryable: false };
        default:
            return undefined;
    }
}

// ============================================================================
// STORED METADATA
// ============================================================================

export function buildStoredErrorMetadata({
    classification,
    requestId,
}: {
    classification: ErrorClassification;
    requestId?: string | null;
}): StoredErrorMetadata {
    return {
        code: classification.code,
        retryable: classification.retryable,
        ...(classification.kind && { kind: classification.kind }),
        ...(requestId && { referenceId: requestId }),
    };
}

// ============================================================================
// RAW DETAIL — dev-only WS overlay + log forensics, never persisted
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

export function extractRawErrorMessage(error: unknown): string | undefined {
    const serialized = serializeException(error);
    const fromSerialized = isRecord(serialized) ? readString(serialized.message) : undefined;
    const fromError = isRecord(error) ? readString(error.message) : undefined;
    return fromSerialized ?? fromError;
}

// ============================================================================
// LOGGING
// ============================================================================

export function buildWorkerErrorLogContext({
    classification,
    stage,
    chatId,
    agentMessageId,
    requestId,
    error,
}: {
    classification: ErrorClassification;
    stage: string;
    chatId?: string;
    agentMessageId?: string;
    requestId?: string | null;
    error?: unknown;
}): WorkerErrorLogContext {
    return {
        stage,
        code: classification.code,
        retryable: classification.retryable,
        ...(classification.kind && { kind: classification.kind }),
        ...(requestId && { referenceId: requestId }),
        ...(chatId && { chatId }),
        ...(agentMessageId && { agentMessageId }),
        ...(error !== undefined && { errorDetail: extractRawErrorMessage(error) }),
    };
}

export function logWorkerError(label: string, context: WorkerErrorLogContext, error: unknown) {
    const serialized = serializeException(error);
    const stack = isRecord(serialized) ? readString(serialized.stack) : undefined;

    console.error(
        `[${label}] error:`,
        JSON.stringify(context),
        stack ?? (isRecord(serialized) && Object.keys(serialized).length > 0 ? serialized : error),
    );
}
