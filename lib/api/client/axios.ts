import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import camelcaseKeys from 'camelcase-keys';
import { REQUEST_ID_HEADER } from '@/lib/api/request-id';
import { ApiClientError } from './types';

export type TokenGetter = () => Promise<string | null>;

export function createAxiosInstance(getToken: TokenGetter): AxiosInstance {
    const instance = axios.create({
        baseURL: '',
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json',
        },
    });

    // Request interceptor - inject auth token
    instance.interceptors.request.use(
        async (config: InternalAxiosRequestConfig) => {
            const token = await getToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        },
        (error) => Promise.reject(error),
    );

    // Response interceptor
    instance.interceptors.response.use(
        // Convert snake_case to camelCase
        (response) => {
            if (response.data && typeof response.data === 'object') {
                response.data = camelcaseKeys(response.data, { deep: true });
            }
            return response;
        },
        (error: AxiosError<{ message?: string; code?: string; details?: Record<string, unknown> }>) => {
            const status = error.response?.status ?? 500;
            const data = error.response?.data;
            const requestId =
                error.response?.headers?.[REQUEST_ID_HEADER.toLowerCase()] ??
                error.response?.headers?.[REQUEST_ID_HEADER];

            throw new ApiClientError({
                message: data?.message ?? error.message ?? 'Request failed',
                status,
                code: data?.code,
                details: data?.details,
                requestId: typeof requestId === 'string' ? requestId : undefined,
            });
        },
    );

    return instance;
}

export function buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    if (!params) return path;

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            searchParams.set(key, String(value));
        }
    }

    const query = searchParams.toString();
    return query ? `${path}?${query}` : path;
}
