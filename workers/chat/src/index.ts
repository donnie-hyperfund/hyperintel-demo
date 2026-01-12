import { Hono } from "hono";
import { HonoEnv, honoMiddlewareAuthedWithOrm, honoMiddlewareWithOrm } from '@worker/hono.helpers';
import { workerHonoOnError, wrapWorker } from '@common/common/common.helpers';
import { getCorsHonoMiddleware } from '@worker/cors.helpers';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';
import { zValidator } from '@hono/zod-validator';
import z from 'zod';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { AIGateway } from '@worker/ai/gateway';
import { initMikroOrmWorker } from '@worker/vendor/mikro';
import { MikroORM } from '@mikro-orm/postgresql';
import createOpenRouterClient from '@worker/vendor/openrouter';
import { chatActionHandler } from "./chat-handler";
import { SendConversationActionSchema } from '@/lib/schema/chat';

const app = new Hono<HonoEnv<Env>>({ strict: false });

app.use(prettyJSON()); // TODO only on dev?
app.use(requestId());
app.use('*', getCorsHonoMiddleware(['GET', 'POST']));
app.get("/health", honoMiddlewareWithOrm, async (c) => {
    const em = c.var.em;
    const result = await em.execute('SELECT 1+1 AS result');
    return c.json({ status: "healthy", db: result[0]?.result });
});
app.use('*', honoMiddlewareAuthedWithOrm);
app.notFound((c) => c.json({ message: 'Not Found', ok: false }, 404));
app.onError((err) => {
	return workerHonoOnError(err);
});

app.post("/chat", zValidator('json', SendConversationActionSchema), async (c) => {
	return wrapWorker(async () => {
		return await chatActionHandler(c.req.valid('json'), c.var);
	});
});


app.get("/", (c) => {
    return c.json({ status: "ok", worker: "chat", userId: c.var.user.userId });
});

export default app;
