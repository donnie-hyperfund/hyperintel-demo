/**
 * Server-side helper for calling worker system actions via the hi-services
 * ChatServices entrypoint.
 *
 * In local dev: calls the in-process `CHAT_SERVICES` instance from
 * `cf-env-secret-mock` directly.
 * In production: POSTs the typed request to `hi-chat`'s
 * `/internal/system-action` endpoint, which hands it to `CHAT_SERVICES`.
 *
 * Fire-and-forget — never blocks the caller.
 */

import { frontendEnv } from '@/lib/env';
import type { SystemActionRequest } from '@/lib/schema/system-actions';

function getWorkerInternalUrl(): string {
    if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKER_HTTP_ORIGIN) {
        return `${frontendEnv.NEXT_PUBLIC_LOCAL_WORKER_HTTP_ORIGIN.replace(/\/$/, '')}/internal/system-action`;
    }
    const alias = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_ALIAS;
    const workerEnv = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV;
    const base = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE;
    const subdomain = [alias, 'hi-chat', workerEnv].filter(Boolean).join('-');
    return `https://${subdomain}.${base}/internal/system-action`;
}

/**
 * Call a worker system action via hi-services.
 * Local: in-process call to the mock ChatServices entrypoint.
 * Prod: HTTP POST to hi-chat which forwards to ChatServices.
 * Fire-and-forget — never blocks the caller.
 */
export async function workerSystemAction(req: SystemActionRequest): Promise<void> {
    try {
        if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS) {
            const { workerEnv } = await import('@/lib/local/cf-env-secret-mock' as string);
            const services = workerEnv.CHAT_SERVICES as
                | { systemAction(req: SystemActionRequest): Promise<void> }
                | undefined;
            if (!services) return;
            await services.systemAction(req);
        } else {
            const secret = process.env.AUTH_SECRET;
            if (!secret) {
                console.warn('[workerSystemAction] AUTH_SECRET not set — skipping WS broadcast');
                return;
            }

            await fetch(getWorkerInternalUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
                body: JSON.stringify(req),
            });
        }
    } catch (err) {
        console.error(`[workerSystemAction] ${req.action} failed:`, err);
    }
}
