const PROXY_ERROR_MARKER = '__generationProxyError';

export type GenerationProxyError = {
    [K in typeof PROXY_ERROR_MARKER]: true;
} & {
    status: number;
    body: string;
    contentType?: string;
};

export function createProxyError(status: number, body: string, contentType?: string): GenerationProxyError {
    return {
        [PROXY_ERROR_MARKER]: true,
        status,
        body,
        contentType,
    } as GenerationProxyError;
}

export function isGenerationProxyError(value: unknown): value is GenerationProxyError {
    return (
        typeof value === 'object' && value !== null && (value as Record<string, unknown>)[PROXY_ERROR_MARKER] === true
    );
}

export function proxyErrorResponse(error: GenerationProxyError): Response {
    return new Response(error.body, {
        status: error.status,
        headers: { 'Content-Type': error.contentType ?? 'application/json' },
    });
}
