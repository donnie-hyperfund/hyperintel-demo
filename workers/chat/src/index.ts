import { workerHonoOnError, wrapWorker } from '@common/common/common.helpers';
import { zValidator } from '@hono/zod-validator';
import { getCorsHonoMiddleware } from '@worker/cors.helpers';
import { HonoEnv, honoMiddlewareAuthedWithOrm, honoMiddlewareWithOrm } from '@worker/hono.helpers';
import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';
import {
    ApproveArtifactActionSchema,
    ConfirmUploadSchema,
    ExportArtifactQuerySchema,
    PresignUploadSchema,
    RejectArtifactActionSchema,
    UploadArtifactSchema,
} from '@/lib/schema/artifact';
import { SendChatActionSchema, SendIntakeChatActionSchema, SummarizeActionSchema } from '@/lib/schema/chat';
import { ImportArtifactsActionSchema } from '@/lib/schema/project';
import { approveArtifactHandler, rejectArtifactHandler } from './artifact-approver';
import { exportArtifactHandler } from './artifact-exporter';
import { importArtifactsHandler } from './artifact-importer';
import { confirmUploadHandler, presignUploadHandler, uploadArtifactHandler } from './artifact-uploader';
import { chatActionHandler } from './chat-handler';
import { cleanupStaleUploads } from './cleanup';
import { intakeActionHandler } from './intake-handler';
import { summarizeActionHandler } from './summarizer';

const app = new Hono<HonoEnv<Env>>({ strict: false });

app.use(prettyJSON());
app.use(requestId());
app.use('*', getCorsHonoMiddleware(['GET', 'POST']));
app.get('/health', honoMiddlewareWithOrm, async (c) => {
    const em = c.var.em;
    const result = await em.execute('SELECT 1+1 AS result');
    return c.json({ status: 'healthy', db: result[0]?.result });
});
app.use('*', honoMiddlewareAuthedWithOrm);
app.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404));
app.onError((err) => {
    return workerHonoOnError(err);
});

app.post('/chat', zValidator('json', SendChatActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await chatActionHandler(c.req.valid('json'), c.var);
    });
});

app.post('/intake', zValidator('json', SendIntakeChatActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await intakeActionHandler(c.req.valid('json'), c.var);
    });
});

app.post('/summarize', zValidator('json', SummarizeActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await summarizeActionHandler(c.req.valid('json'), c.var);
    });
});

app.post('/artifacts/approve', zValidator('json', ApproveArtifactActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await approveArtifactHandler(c.req.valid('json'), c.var);
    });
});

app.post('/artifacts/reject', zValidator('json', RejectArtifactActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await rejectArtifactHandler(c.req.valid('json'), c.var);
    });
});

app.post('/artifacts/import', zValidator('json', ImportArtifactsActionSchema), async (c) => {
    return wrapWorker(async () => {
        return await importArtifactsHandler(c.req.valid('json'), c.var);
    });
});

app.post('/artifacts/upload', zValidator('form', UploadArtifactSchema), async (c) => {
    return wrapWorker(async () => {
        return await uploadArtifactHandler(c.req.valid('form'), c.var);
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
        return await exportArtifactHandler(c.req.valid('query'), c.var);
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
