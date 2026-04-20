export const REQUEST_ID_HEADER = 'X-Request-Id';

export function getOrCreateRequestId(headers: Pick<Headers, 'get'>): string {
    const requestId = headers.get(REQUEST_ID_HEADER)?.trim();
    return requestId ? requestId : crypto.randomUUID();
}

export function withRequestIdHeader<T extends Response>(response: T, requestId: string): T {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
}
