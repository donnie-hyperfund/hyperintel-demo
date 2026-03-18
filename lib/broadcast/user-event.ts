/**
 * Server-side helper for broadcasting user-scoped events via the UserGateway DO.
 *
 * In local dev: uses the mock DO namespace from envSecretMocks.
 * In production: calls the worker's /internal/broadcast HTTP endpoint.
 */

import { frontendEnv } from '@/lib/env';

function getWorkerInternalUrl(): string {
    const alias = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_ALIAS;
    const workerEnv = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV;
    const base = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE;
    const subdomain = [alias, 'hi-chat', workerEnv].filter(Boolean).join('-');
    return `https://${subdomain}.${base}/internal/broadcast`;
}

/**
 * Broadcast a user-scoped event to all WebSocket connections for the given user.
 * Fire-and-forget — never blocks the primary operation.
 *
 * @param userId - Clerk user ID (what UserGateway is keyed by)
 * @param eventType - e.g. 'project_created', 'chat_created'
 * @param payload - minimal event-specific data (IDs, status)
 */
export async function broadcastUserEvent(userId: string, eventType: string, payload: unknown): Promise<void> {
    try {
        if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS) {
            // Local dev — use mock DO namespace directly
            const { envSecretMocks } = await import('@/lib/local/cf-env-secret-mock');
            const ugNamespace = envSecretMocks.USER_GATEWAY as any;
            if (!ugNamespace) return;
            const ugId = ugNamespace.idFromName(userId);
            const ugStub = ugNamespace.get(ugId);
            await ugStub.broadcastToAll({ type: 'user_event', eventType, payload });
        } else {
            // Production — call worker's internal broadcast endpoint
            const secret = process.env.AUTH_SECRET;
            if (!secret) return;

            await fetch(getWorkerInternalUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
                body: JSON.stringify({ userId, eventType, payload }),
            });
        }
    } catch (err) {
        console.error('[broadcastUserEvent] Failed:', err);
    }
}
