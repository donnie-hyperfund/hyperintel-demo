import { Hono } from 'hono';

const app = new Hono<{ Bindings: ObjectsEnv }>();

app.get('/', (c) => c.json({ status: 'ok', worker: 'objects' }));
app.get('/health', (c) => c.json({ status: 'healthy' }));

export { ChatStreamDO } from './objects/chat-stream-do';
export { GenerationProxyDO } from './objects/generation-proxy-do';
export { LocksService } from './objects/locks-service';
export { UserGateway } from './objects/user-gateway';

export default app;
