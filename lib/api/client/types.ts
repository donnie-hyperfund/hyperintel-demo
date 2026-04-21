import type { CamelCase } from 'type-fest';

export type CamelCaseDto<T> = T extends Date
    ? Date
    : T extends Array<infer U>
      ? CamelCaseDto<U>[]
      : T extends Record<string, unknown>
        ? { [K in keyof T as K extends string ? CamelCase<K> : K]: CamelCaseDto<T[K]> }
        : T;

export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface PaginationParams {
    page?: number;
    limit?: number;
}

export interface InfinitePaginationParams {
    limit?: number;
}

export interface ApiError {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
    requestId?: string;
}

export class ApiClientError extends Error {
    status: number;
    code?: string;
    details?: Record<string, unknown>;
    requestId?: string;

    constructor({
        message,
        status,
        code,
        details,
        requestId,
    }: {
        message: string;
        status: number;
        code?: string;
        details?: Record<string, unknown>;
        requestId?: string;
    }) {
        super(message);
        this.name = 'ApiClientError';
        this.status = status;
        this.code = code;
        this.details = details;
        this.requestId = requestId;
    }
}

export type UploadStatus = 'idle' | 'uploading' | 'success';
