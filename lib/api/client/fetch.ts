export type EmptyResponseDto = void;
export type ErrorResponseDto = { message?: string; code?: string; details?: Record<string, unknown> };

export type TypedSuccessResponse<T> = Omit<Response, 'ok' | 'json'> & {
    ok: true;
    json(): Promise<T>;
};

export type TypedErrorResponse<E> = Omit<Response, 'ok' | 'json'> & {
    ok: false;
    json(): Promise<E>;
};

export type TypedResponse<R = EmptyResponseDto, E = ErrorResponseDto> = TypedSuccessResponse<R> | TypedErrorResponse<E>;

export function typedFetch<R = EmptyResponseDto, E = ErrorResponseDto>(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<TypedResponse<R, E>> {
    return fetch(input, init) as Promise<TypedResponse<R, E>>;
}
