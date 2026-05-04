import { describe, expect, it } from 'vitest';
import { createProxyError, isGenerationProxyError, proxyErrorResponse } from './proxy-error';

describe('proxy-error', () => {
    it('creates and detects proxy errors', () => {
        const error = createProxyError(400, '{"code":"CONTEXT_TOO_LONG"}', 'application/json');

        expect(isGenerationProxyError(error)).toBe(true);
        expect(isGenerationProxyError({ status: 400, body: '{}' })).toBe(false);
        expect(isGenerationProxyError(null)).toBe(false);
        expect(error.status).toBe(400);
        expect(error.body).toBe('{"code":"CONTEXT_TOO_LONG"}');
        expect(error.contentType).toBe('application/json');
    });

    it('turns a proxy error back into a Response', async () => {
        const response = proxyErrorResponse(createProxyError(429, 'too much', 'text/plain'));

        expect(response.status).toBe(429);
        expect(response.headers.get('content-type')).toBe('text/plain');
        await expect(response.text()).resolves.toBe('too much');
    });

    it('defaults proxy error responses to json content type', () => {
        const response = proxyErrorResponse(createProxyError(500, '{}'));

        expect(response.headers.get('content-type')).toBe('application/json');
    });
});
