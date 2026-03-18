import { workerHonoOnError, wrapWorker } from '@common/common/common.helpers';
import { zValidator } from '@hono/zod-validator';
import { getCorsHonoMiddleware } from '@worker/cors.helpers';
import { HonoEnv, honoMiddlewareAuthedWithOrm, honoMiddlewareWithOrm } from '@worker/hono.helpers';
import { branchDoName, getPreviewAlias } from '@/workers/_common/util/preview-alias';
import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';
import { ChatEntity } from '@/lib/orm/entities';
import type { Ctx } from './context';
import {
    ApproveArtifactActionSchema,
    ConfirmUploadSchema,
    DeleteArtifactSchema,
    ExportArtifactQuerySchema,
    PresignUploadSchema,
    RejectArtifactActionSchema,
    UploadArtifactSchema,
} from '@/lib/schema/artifact';
import {
    AbortActionSchema,
    SendChatActionSchema,
    SendIntakeChatActionSchema,
    SummarizeActionSchema,
} from '@/lib/schema/chat';
import { ImportArtifactsActionSchema } from '@/lib/schema/project';
import { approveArtifactHandler, rejectArtifactHandler } from './artifact-approver';
import { deleteArtifactHandler } from './artifact-deleter';
import { exportArtifactHandler } from './artifact-exporter';
import { importArtifactsHandler } from './artifact-importer';
import { confirmUploadHandler, presignUploadHandler, uploadArtifactHandler } from './artifact-uploader';
import { chatActionHandler } from './chat-handler';
import { cleanupStaleUploads } from './cleanup';
import { intakeActionHandler } from './intake-handler';
import { summarizeActionHandler } from './summarizer';

const app = new Hono<HonoEnv<Env>>({ strict: false });

/** Build Ctx with preview alias resolved from the request (null on prod) */
function ctxWithAlias(c: { env: Env; req: { raw: Request }; var: any }): Ctx {
    return { ...c.var, previewAlias: getPreviewAlias(c.env as any, c.req.raw) };
}

app.use(prettyJSON());
app.use(requestId());
app.use('*', getCorsHonoMiddleware(['GET', 'POST']));
app.get('/health', honoMiddlewareWithOrm, async (c) => {
    const em = c.var.em;
    const result = await em.execute('SELECT 1+1 AS result');
    return c.json({ status: 'healthy', db: result[0]?.result });
});

// Internal M2M endpoint — registered BEFORE honoMiddlewareAuthedWithOrm (no Clerk auth)
app.post('/internal/broadcast', async (c) => {
    const secret = await c.env.AUTH_SECRET.get();
    if (c.req.header('Authorization') !== `Bearer ${secret}`) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const { userId, eventType, payload } = await c.req.json();
    if (!userId || !eventType) return c.json({ error: 'Missing userId or eventType' }, 400);

    const alias = getPreviewAlias(c.env as any, c.req.raw);
    const ugId = c.env.USER_GATEWAY.idFromName(branchDoName(userId, alias));
    const ugStub = c.env.USER_GATEWAY.get(ugId);
    await (ugStub as any).broadcastToAll({ type: 'user_event', eventType, payload });
    return c.json({ ok: true });
});

app.use('*', honoMiddlewareAuthedWithOrm);
app.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404));
app.onError((err) => {
    return workerHonoOnError(err);
});

app.post('/abort', zValidator('json', AbortActionSchema), (c) => {
    return wrapWorker(async () => {
        const { chatId, agentMessageId } = c.req.valid('json');
        // Ownership check — throws 404 if user doesn't own this chat
        await c.var.em!.findOneOrFail(ChatEntity, {
            id: chatId,
            project: { user: { clerkId: c.var.user.userId } },
        });
        const alias = getPreviewAlias(c.env as any, c.req.raw);
        const streamDO = c.env.CHAT_STREAM_DO.get(c.env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, alias)));
        await streamDO.abort(chatId);
        return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    });
});

// ── SSE stream endpoints (called by GenerationProxyDO, not by clients directly) ──

app.post('/stream/chat', zValidator('json', SendChatActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await chatActionHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/stream/intake', zValidator('json', SendIntakeChatActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await intakeActionHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/stream/summarize', zValidator('json', SummarizeActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await summarizeActionHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

// ── Public proxy endpoints — thin wrappers that delegate to GenerationProxyDO ──

function buildStreamUrl(req: Request, path: string): string {
    const url = new URL(req.url);
    return `${url.origin}/stream${path}`;
}

type GenerationProxyDOStub = DurableObjectStub & {
    run(url: string, body: string, authHeader: string): Promise<unknown>;
};

app.post('/chat', zValidator('json', SendChatActionSchema), async (c) => {
    return wrapWorker(async () => {
        const proxyDO = c.env.GENERATION_PROXY.get(
            c.env.GENERATION_PROXY.newUniqueId(),
        ) as unknown as GenerationProxyDOStub;

        const streamUrl = buildStreamUrl(c.req.raw, '/chat');
        const body = JSON.stringify(c.req.valid('json'));
        const authHeader = c.req.header('Authorization') ?? '';

        return await proxyDO.run(streamUrl, body, authHeader);
    });
});

app.post('/intake', zValidator('json', SendIntakeChatActionSchema), async (c) => {
    return wrapWorker(async () => {
        const proxyDO = c.env.GENERATION_PROXY.get(
            c.env.GENERATION_PROXY.newUniqueId(),
        ) as unknown as GenerationProxyDOStub;

        const streamUrl = buildStreamUrl(c.req.raw, '/intake');
        const body = JSON.stringify(c.req.valid('json'));
        const authHeader = c.req.header('Authorization') ?? '';

        return await proxyDO.run(streamUrl, body, authHeader);
    });
});

app.post('/summarize', zValidator('json', SummarizeActionSchema), async (c) => {
    return wrapWorker(async () => {
        const proxyDO = c.env.GENERATION_PROXY.get(
            c.env.GENERATION_PROXY.newUniqueId(),
        ) as unknown as GenerationProxyDOStub;

        const streamUrl = buildStreamUrl(c.req.raw, '/summarize');
        const body = JSON.stringify(c.req.valid('json'));
        const authHeader = c.req.header('Authorization') ?? '';

        return await proxyDO.run(streamUrl, body, authHeader);
    });
});

app.post('/artifacts/approve', zValidator('json', ApproveArtifactActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await approveArtifactHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/reject', zValidator('json', RejectArtifactActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await rejectArtifactHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/delete', zValidator('json', DeleteArtifactSchema), async (c) => {
    return wrapWorker(async () => {
        return await deleteArtifactHandler(c.req.valid('json'), c.var);
    });
});

app.post('/artifacts/import', zValidator('json', ImportArtifactsActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await importArtifactsHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/upload', zValidator('form', UploadArtifactSchema), async (c) => {
    return wrapWorker(async () => {
        return await uploadArtifactHandler(c.req.valid('form'), ctxWithAlias(c));
    });
});

app.post('/artifacts/upload/presign', zValidator('json', PresignUploadSchema), async (c) => {
    return wrapWorker(async () => {
        return await presignUploadHandler(c.req.valid('json'), c.var);
    });
});

app.post('/artifacts/upload/confirm', zValidator('json', ConfirmUploadSchema), async (c) => {
    return wrapWorker(async () => {
        return await confirmUploadHandler(c.req.valid('json'), c.var);
    });
});

app.get('/artifacts/export', zValidator('query', ExportArtifactQuerySchema), async (c) => {
    return wrapWorker(async () => {
        return await exportArtifactHandler(c.req.valid('query'), ctxWithAlias(c));
    });
});

app.get('/', (c) => {
    return c.json({ status: 'ok', worker: 'chat', userId: c.var.user.userId });
});

export default {
    fetch: app.fetch,
    async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        ctx.waitUntil(cleanupStaleUploads(env));
    },
};
