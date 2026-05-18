import { Hono } from 'hono';

const app = new Hono<{ Bindings: StreamStateEnv }>();

app.get('/', (c) => c.json({ status: 'ok', worker: 'hi-stream-state' }));
app.get('/health', (c) => c.json({ status: 'healthy' }));

export { ChatStreamStateDO } from './objects/chat-stream-state-do';

export default app;
