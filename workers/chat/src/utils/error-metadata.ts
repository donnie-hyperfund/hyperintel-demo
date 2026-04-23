import { PublicError } from '@common/common/error.helpers';
import { serializeException } from '@/common/ai/utils';

export type PublicErrorMetadata = {
    error: string;
    errorCode?: string;
    requestId?: string;
};

export type WorkerErrorLogContext = PublicErrorMetadata & {
    stage: string;
    chatId?: string;
    agentMessageId?: string;
    errorStatus?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
}

function getSerializedErrorRecord(error: unknown): Record<string, unknown> {
    const serialized = serializeException(error);
    return isRecord(serialized) ? serialized : {};
}

function resolveStatusCode(error: unknown, serialized: Record<string, unknown>): number | undefined {
    if (error instanceof PublicError) {
        return error.statusCode;
    }

    if (isRecord(error)) {
        if (typeof error.status === 'number') {
            return error.status;
        }

        const response = isRecord(error.response) ? error.response : undefined;
        if (typeof response?.status === 'number') {
            return response.status;
        }
    }

    return typeof serialized.status === 'number' ? serialized.status : undefined;
}

function resolveErrorCode(error: unknown, serialized: Record<string, unknown>): string | undefined {
    if (error instanceof PublicError) {
        return error.code;
    }

    if (isRecord(error)) {
        const directCode = readString(error.code);
        if (directCode) {
            return directCode;
        }
    }

    const serializedCode = readString(serialized.code);
    if (serializedCode) {
        return serializedCode;
    }

    const statusCode = resolveStatusCode(error, serialized);
    return statusCode ? `HTTP_${statusCode}` : undefined;
}

export function buildPublicErrorMetadata({
    error,
    fallbackMessage,
    requestId,
}: {
    error: unknown;
    fallbackMessage?: string;
    requestId?: string | null;
}): PublicErrorMetadata {
    const serialized = getSerializedErrorRecord(error);
    const errorMessage =
        readString(fallbackMessage) ??
        readString(serialized.message) ??
        (isRecord(error) ? readString(error.message) : undefined) ??
        'Unknown error';
    const errorCode = resolveErrorCode(error, serialized);

    return {
        error: errorMessage,
        ...(errorCode ? { errorCode } : {}),
        ...(requestId ? { requestId } : {}),
    };
}

export function buildWorkerErrorLogContext({
    error,
    stage,
    chatId,
    agentMessageId,
    requestId,
    fallbackMessage,
    errorMetadata,
}: {
    error: unknown;
    stage: string;
    chatId?: string;
    agentMessageId?: string;
    requestId?: string | null;
    fallbackMessage?: string;
    errorMetadata?: PublicErrorMetadata;
}): WorkerErrorLogContext {
    const serialized = getSerializedErrorRecord(error);
    const metadata = buildPublicErrorMetadata({
        error,
        fallbackMessage,
        requestId: requestId ?? errorMetadata?.requestId,
    });
    const errorStatus = resolveStatusCode(error, serialized);

    return {
        stage,
        error: metadata.error,
        ...(metadata.errorCode || errorMetadata?.errorCode
            ? { errorCode: metadata.errorCode ?? errorMetadata?.errorCode }
            : {}),
        ...(metadata.requestId || errorMetadata?.requestId
            ? { requestId: metadata.requestId ?? errorMetadata?.requestId }
            : {}),
        ...(chatId ? { chatId } : {}),
        ...(agentMessageId ? { agentMessageId } : {}),
        ...(typeof errorStatus === 'number' ? { errorStatus } : {}),
    };
}

export function logWorkerError(label: string, context: WorkerErrorLogContext, error: unknown) {
    const serialized = getSerializedErrorRecord(error);
    const stack = readString(serialized.stack);

    console.error(
        `[${label}] error:`,
        JSON.stringify(context),
        stack ?? (Object.keys(serialized).length > 0 ? serialized : error),
    );
}
