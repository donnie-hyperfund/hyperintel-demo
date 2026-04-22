import type { Ctx } from '../context';

type AnalyticsPrimitive = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsPrimitive>;

function compactProperties(properties: AnalyticsProperties) {
    return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined && value !== null));
}

async function resolvePostHogConfig(ctx: Ctx) {
    const env = ctx.env as Env & {
        POSTHOG_HOST?: string;
        POSTHOG_KEY?: { get(): Promise<string> };
    };

    const host = env.POSTHOG_HOST ?? process.env.POSTHOG_HOST;
    const key = (await env.POSTHOG_KEY?.get?.().catch(() => null)) ?? process.env.POSTHOG_KEY ?? null;

    if (!host || !key) return null;
    return { host: host.replace(/\/$/, ''), key };
}

export async function captureWorkerPostHogEvent(
    ctx: Ctx,
    event: string,
    distinctId: string,
    properties: AnalyticsProperties = {},
) {
    const config = await resolvePostHogConfig(ctx);
    if (!config) return;

    const payload = {
        api_key: config.key,
        event,
        distinct_id: distinctId,
        properties: compactProperties({
            ...properties,
            worker_name: ctx.env.WORKER_NAME,
            worker_env: ctx.env.ENV,
            posthog_source: 'worker',
        }),
    };

    await fetch(`${config.host}/capture/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
}
