import { workerHonoOnError, wrapWorker } from '@common/common/common.helpers';
import { zValidator } from '@hono/zod-validator';
import { getCorsHonoMiddleware } from '@worker/cors.helpers';
import { HonoEnv, honoMiddlewareAuthedWithOrm, honoMiddlewareWithOrm } from '@worker/hono.helpers';
import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';
import { z } from 'zod';
import { isGenerationProxyError, proxyErrorResponse } from '@/lib/api/proxy-error';
import { signArtifactImageKeys } from '@/lib/artifacts/artifact-images';
import { ChatEntity, ChatMessageFileEntity, ProjectEntity } from '@/lib/orm/entities';
import { getAvailablePresets, getDefaultPresetId } from '@/lib/presets';
import {
    ApproveArtifactActionSchema,
    AssociateUploadsSchema,
    ClearDraftsSchema,
    ConfirmUploadSchema,
    DeleteArtifactSchema,
    ExportArtifactQuerySchema,
    PresignUploadSchema,
    RejectArtifactActionSchema,
    RestoreArtifactActionSchema,
    UploadArtifactSchema,
} from '@/lib/schema/artifact';
import {
    AbortActionSchema,
    SendChatActionSchema,
    SendIntakeChatActionSchema,
    SummarizeActionSchema,
} from '@/lib/schema/chat';
import { ImportArtifactsActionSchema } from '@/lib/schema/project';
import { branchDoName, getPreviewAlias } from '@/workers/_common/util/preview-alias';
import { approveArtifactHandler, rejectArtifactHandler } from './artifact-approver';
import { deleteArtifactHandler } from './artifact-deleter';
import { exportArtifactHandler } from './artifact-exporter';
import { importArtifactsHandler } from './artifact-importer';
import { restoreArtifactHandler } from './artifact-restorer';
import { chatActionHandler } from './chat-handler';
import type { Ctx } from './context';
import { intakeActionHandler } from './intake-handler';
import { summarizeActionHandler } from './summarizer';
import { confirmUploadHandler, presignUploadHandler, uploadArtifactHandler } from './uploads/artifact-uploader';
import { associateUploadsHandler } from './uploads/associate-handler';
import { cleanupStaleUploads } from './uploads/cleanup';
import { clearDraftsHandler } from './uploads/draft-clear-handler';
import {
    ConfirmImageUploadSchema,
    confirmImageUploadHandler,
    PresignImageUploadSchema,
    presignImageUploadHandler,
} from './uploads/image-uploader';
import type { UserGatewayStub } from './utils/do-stubs';

const app = new Hono<HonoEnv<Env>>({ strict: false });
const UuidSchema = z.string().uuid();

/** Build Ctx with preview alias + request ID resolved from the request */
function ctxWithAlias(c: {
    env: Env;
    req: { raw: Request };
    var: any;
    get: (key: 'requestId') => string | undefined;
}): Ctx {
    return {
        ...c.var,
        previewAlias: getPreviewAlias(c.env as any, c.req.raw),
        requestId: c.get('requestId') ?? null,
    };
}

app.use(prettyJSON());
app.use(requestId());
app.use('*', getCorsHonoMiddleware(['GET', 'POST']));
app.get('/health', honoMiddlewareWithOrm, async (c) => {
    const em = c.var.em;
    const result = await em.execute('SELECT 1+1 AS result');
    return c.json({ status: 'healthy', db: result[0]?.result });
});

app.get('/presets', (c) => {
    const presets = getAvailablePresets(c.env.ALLOWED_PRESETS, c.env.BLOCKED_PRESETS);
    return c.json({
        presets: presets.map((p) => ({ id: p.id, label: p.label, description: p.description })),
        defaultPresetId: getDefaultPresetId(c.env),
    });
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

// Internal M2M endpoint — topic-scoped system action (e.g. modelChanged broadcast)
app.post('/internal/system-action', async (c) => {
    const secret = await c.env.AUTH_SECRET.get();
    if (c.req.header('Authorization') !== `Bearer ${secret}`) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const { userId, topic, action, payload } = await c.req.json();
    if (!userId || !topic || !action) return c.json({ error: 'Missing userId, topic, or action' }, 400);

    const alias = getPreviewAlias(c.env as any, c.req.raw);
    const ugId = c.env.USER_GATEWAY.idFromName(branchDoName(userId, alias));
    const ugStub = c.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;
    await ugStub.systemAction(topic, action, payload, alias ?? undefined);
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

        const result = await proxyDO.run(streamUrl, body, authHeader);
        return isGenerationProxyError(result) ? proxyErrorResponse(result) : result;
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

        const result = await proxyDO.run(streamUrl, body, authHeader);
        return isGenerationProxyError(result) ? proxyErrorResponse(result) : result;
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

        const result = await proxyDO.run(streamUrl, body, authHeader);
        return isGenerationProxyError(result) ? proxyErrorResponse(result) : result;
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
        return await deleteArtifactHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/restore', zValidator('json', RestoreArtifactActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await restoreArtifactHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/import', zValidator('json', ImportArtifactsActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await importArtifactsHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/uploads/associate', zValidator('json', AssociateUploadsSchema), async (c) => {
    return wrapWorker(async () => {
        return await associateUploadsHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/uploads/drafts/clear', zValidator('json', ClearDraftsSchema), async (c) => {
    return wrapWorker(async () => {
        return await clearDraftsHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/upload', zValidator('form', UploadArtifactSchema), async (c) => {
    return wrapWorker(async () => {
        return await uploadArtifactHandler(c.req.valid('form'), ctxWithAlias(c));
    });
});

app.post('/artifacts/upload/presign', zValidator('json', PresignUploadSchema), async (c) => {
    return wrapWorker(async () => {
        return await presignUploadHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/artifacts/upload/confirm', zValidator('json', ConfirmUploadSchema), async (c) => {
    return wrapWorker(async () => {
        return await confirmUploadHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

// ── Image upload endpoints (chat message attachments) ──

app.post('/images/upload/presign', zValidator('json', PresignImageUploadSchema), async (c) => {
    return wrapWorker(async () => {
        return await presignImageUploadHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.post('/images/upload/confirm', zValidator('json', ConfirmImageUploadSchema), async (c) => {
    return wrapWorker(async () => {
        return await confirmImageUploadHandler(c.req.valid('json'), ctxWithAlias(c));
    });
});

app.get('/images/:fileId', async (c) => {
    const fileId = c.req.param('fileId');
    const em = c.var.em!;

    const file = await em.findOne(ChatMessageFileEntity, { id: fileId });
    if (!file) return c.json({ error: 'Not found' }, 404);

    // Verify ownership via chat → project → user chain
    const chat = await em.findOne(ChatEntity, {
        id: file.chat_id,
        $or: [{ project: { user: { clerkId: c.var.user.userId } } }, { user: { clerkId: c.var.user.userId } }],
    });
    if (!chat) return c.json({ error: 'Not found' }, 404);

    if (!c.env.USER_IMAGES_BUCKET) return c.json({ error: 'Storage not configured' }, 500);

    const r2Object = await c.env.USER_IMAGES_BUCKET.get(file.storage_key);
    if (!r2Object) return c.json({ error: 'File not found in storage' }, 404);

    return new Response(r2Object.body, {
        headers: {
            'Content-Type': file.mime_type,
            'Cache-Control': 'private, max-age=3600',
            'Content-Disposition': `inline; filename="${file.original_name}"`,
        },
    });
});

// ── Artifact image redirect (signed R2 URL) ──

app.get('/artifact-image/*', async (c) => {
    const key = c.req.path.replace('/artifact-image/', '');
    if (!key) return c.json({ error: 'Missing key' }, 404);

    // Key pattern: uploads/{project|chat}/{id}/{artifactId}/images/{filename}
    const parts = key.split('/');
    if (parts.length !== 6 || parts[0] !== 'uploads' || parts[4] !== 'images' || !parts[5]) {
        return c.json({ error: 'Invalid artifact image key' }, 404);
    }

    const scopeType = parts[1]; // 'project' or 'chat'
    const scopeId = parts[2];
    const artifactId = parts[3];
    const em = c.var.em!;
    const clerkId = c.var.user.userId;

    if (!UuidSchema.safeParse(scopeId).success || !UuidSchema.safeParse(artifactId).success) {
        return c.json({ error: 'Invalid artifact image key' }, 404);
    }

    if (scopeType === 'project') {
        const project = await em.findOne(ProjectEntity, {
            id: scopeId,
            user: { clerkId },
            archived_at: null,
        });
        if (!project) return c.json({ error: 'Not found' }, 404);
    } else if (scopeType === 'chat') {
        const chat = await em.findOne(ChatEntity, {
            id: scopeId,
            $or: [{ project: { user: { clerkId } } }, { user: { clerkId } }],
        });
        if (!chat) return c.json({ error: 'Not found' }, 404);
    } else {
        return c.json({ error: 'Invalid artifact image key' }, 404);
    }

    const urlMap = await signArtifactImageKeys(c.env, [key]);
    const signedUrl = urlMap.get(key);
    if (!signedUrl) return c.json({ error: 'Failed to sign image key' }, 500);

    return new Response(null, {
        status: 302,
        headers: {
            Location: signedUrl,
            'Cache-Control': 'private, max-age=3000',
        },
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
