/**
 * Server-side helper for calling worker system actions via the UserGateway DO.
 *
 * In local dev: uses the mock DO namespace from envSecretMocks (in-process).
 * In production: calls the worker's /internal/system-action HTTP endpoint.
 * Fire-and-forget — never blocks the caller.
 */

import { frontendEnv } from '@/lib/env';

function getWorkerInternalUrl(): string {
	const alias = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_ALIAS;
	const workerEnv = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV;
	const base = frontendEnv.NEXT_PUBLIC_CLOUDFLARE_BASE;
	const subdomain = [alias, 'hi-chat', workerEnv].filter(Boolean).join('-');
	return `https://${subdomain}.${base}/internal/system-action`;
}

/**
 * Call a worker system action via the UserGateway DO.
 * Local: calls mock DO directly (in-process). Prod: HTTP to worker.
 * Fire-and-forget — never blocks the caller.
 */
export async function workerSystemAction(
	userId: string,
	topic: string,
	action: string,
	payload: unknown,
): Promise<void> {
	try {
		if (frontendEnv.NEXT_PUBLIC_LOCAL_WORKERS) {
			const { envSecretMocks } = await import('@/lib/local/cf-env-secret-mock');
			const ugNamespace = envSecretMocks.USER_GATEWAY as any;
			if (!ugNamespace) return;
			const ugId = ugNamespace.idFromName(userId);
			const ugStub = ugNamespace.get(ugId);
			await ugStub.systemAction(topic, action, payload);
		} else {
			const secret = process.env.AUTH_SECRET;
			if (!secret) {
				console.warn('[workerSystemAction] AUTH_SECRET not set — skipping WS broadcast');
				return;
			}

			await fetch(getWorkerInternalUrl(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
				body: JSON.stringify({ userId, topic, action, payload }),
			});
		}
	} catch (err) {
		console.error(`[workerSystemAction] ${action} failed:`, err);
	}
}
