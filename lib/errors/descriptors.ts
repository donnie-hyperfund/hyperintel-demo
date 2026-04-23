import type { PublicErrorCode } from '@/common/ai';

/**
 * Rules:
 *   1. `Record<PublicErrorCode, …>` enforces one descriptor per code at compile time.
 *   2. Titles are neutral statements — never prescribe action. Advice belongs on buttons.
 *   3. Titles do not reference internals (model names, providers, JSON).
 */

export type RetryAffordance = 'suggested' | 'available' | 'unavailable';

export type ErrorDescriptor = {
    code: PublicErrorCode;
    title: string;
    retry: RetryAffordance;
};

const DESCRIPTORS: Record<PublicErrorCode, ErrorDescriptor> = {
    RATE_LIMITED: {
        code: 'RATE_LIMITED',
        title: 'The service is busy.',
        retry: 'suggested',
    },
    SERVICE_OVERLOADED: {
        code: 'SERVICE_OVERLOADED',
        title: 'The service is temporarily overloaded.',
        retry: 'suggested',
    },
    SERVICE_UNAVAILABLE: {
        code: 'SERVICE_UNAVAILABLE',
        title: 'The service is temporarily unavailable.',
        retry: 'available',
    },
    NETWORK_ERROR: {
        code: 'NETWORK_ERROR',
        title: 'The connection was lost.',
        retry: 'suggested',
    },
    CONTEXT_TOO_LONG: {
        code: 'CONTEXT_TOO_LONG',
        title: 'This conversation has grown too long for the selected model.',
        retry: 'unavailable',
    },
    CONTENT_POLICY: {
        code: 'CONTENT_POLICY',
        title: 'This response was blocked by a content policy.',
        retry: 'unavailable',
    },
    MODEL_UNAVAILABLE: {
        code: 'MODEL_UNAVAILABLE',
        title: 'The selected model is unavailable.',
        retry: 'unavailable',
    },
    INVALID_REQUEST: {
        code: 'INVALID_REQUEST',
        title: 'The request could not be processed.',
        retry: 'unavailable',
    },
    INCOMPLETE_RESPONSE: {
        code: 'INCOMPLETE_RESPONSE',
        title: 'The response ended before it was complete.',
        retry: 'suggested',
    },
    UNKNOWN: {
        code: 'UNKNOWN',
        title: 'The request could not be completed.',
        retry: 'available',
    },
};

export function describeError(code: PublicErrorCode | undefined | null): ErrorDescriptor {
    if (!code) return DESCRIPTORS.UNKNOWN;
    return DESCRIPTORS[code] ?? DESCRIPTORS.UNKNOWN;
}
