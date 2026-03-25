import { branchDoName } from '@/workers/_common/util/preview-alias';
import type { Ctx } from '../context';
import type { UserGatewayStub } from './do-stubs';

/**
 * Resolve the UserGateway DO stub for the current user.
 */
export function getUserGatewayStub(ctx: Pick<Ctx, 'env' | 'user' | 'previewAlias'>): UserGatewayStub {
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, ctx.previewAlias));
    return ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
}

/**
 * Broadcast a user-scoped event to all WS connections for the current user.
 *
 * Uses `waitUntil` when an ExecutionContext is available so the response can be
 * returned immediately while the DO RPC finishes in the background.
 * Falls back to `await` so the RPC always completes before the Worker terminates.
 */
export async function broadcastUserEvent(
    ctx: Pick<Ctx, 'env' | 'user' | 'previewAlias' | 'eCtx'>,
    eventType: string,
    payload: unknown,
): Promise<void> {
    const ugStub = getUserGatewayStub(ctx);
    const task = ugStub.broadcastToAll({ type: 'user_event', eventType, payload }).catch((error) => {
        console.error(`[broadcast] Failed to broadcast ${eventType}:`, error);
    });

    if (ctx.eCtx) {
        ctx.eCtx.waitUntil(task);
        return;
    }
    await task;
}
