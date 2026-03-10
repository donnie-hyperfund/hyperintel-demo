import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.json({ status: 'ok', worker: 'objects' }));
app.get('/health', (c) => c.json({ status: 'healthy' }));

export { UserGateway } from './objects/user-gateway';
export { ChatStreamDO } from './objects/chat-stream-do';
export { GenerationProxyDO } from './objects/generation-proxy-do';

export default app;
