// Common utilities for all workers
// Add shared helpers, types, and utilities here

export function createJsonResponse<T>(data: T, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

export function createErrorResponse(message: string, status = 500): Response {
    return createJsonResponse({ error: message }, status)
}
