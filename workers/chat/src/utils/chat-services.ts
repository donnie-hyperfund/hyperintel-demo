import type { SystemActionName, SystemActionRequest } from '@/lib/schema/system-actions';
import { writeStreamMetric } from '@/workers/_common/vendor/analytics-engine';
import type { Ctx } from '../context';

const SYSTEM_ACTION_METRICS: Record<SystemActionName, string> = {
    registerStream: 'services_register_stream_rpc',
    messageCreated: 'services_message_created_rpc',
    modelChanged: 'services_model_changed_rpc',
    cbStatusChanged: 'services_cb_status_changed_rpc',
};

function systemActionIndex(req: SystemActionRequest): string {
    return req.action === 'registerStream' ? req.agentMessageId : req.identifier;
}

function writeSystemActionMetric(
    env: ChatEnv,
    req: SystemActionRequest,
    t0UnixMs: number,
    durationMs: number,
    success: boolean,
) {
    writeStreamMetric(env, {
        metric: SYSTEM_ACTION_METRICS[req.action],
        indexes: [systemActionIndex(req)],
        blobs: [req.identifier, req.previewAlias, req.action, req.prefix],
        doubles: [durationMs, success ? 1 : 0, t0UnixMs],
    });
}

export async function callChatServicesSystemAction(ctx: Pick<Ctx, 'env'>, req: SystemActionRequest): Promise<void> {
    const t0UnixMs = Date.now();
    const t0 = performance.now();
    try {
        await ctx.env.CHAT_SERVICES.systemAction(req);
        writeSystemActionMetric(ctx.env, req, t0UnixMs, performance.now() - t0, true);
    } catch (err) {
        writeSystemActionMetric(ctx.env, req, t0UnixMs, performance.now() - t0, false);
        throw err;
    }
}
