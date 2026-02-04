import { workerHonoOnError, wrapWorker } from '@common/common/common.helpers';
import { zValidator } from '@hono/zod-validator';
import { getCorsHonoMiddleware } from '@worker/cors.helpers';
import { HonoEnv, honoMiddlewareAuthedWithOrm, honoMiddlewareWithOrm } from '@worker/hono.helpers';
import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';
import { SendChatActionSchema, SummarizeActionSchema } from '@/lib/schema/chat';
import { ApproveArtifactActionSchema, RejectArtifactActionSchema } from '@/lib/schema/artifact';
import { chatActionHandler } from './chat-handler';
import { summarizeActionHandler } from './summarizer';
import { approveArtifactHandler, rejectArtifactHandler } from './artifact-approver';

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

app.get('/', (c) => {
    return c.json({ status: 'ok', worker: 'chat', userId: c.var.user.userId });
});

export default app;
