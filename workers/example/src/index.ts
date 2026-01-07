import { getCorsHonoMiddleware } from '@worker/cors.helpers';
import { createErrorResponse, createJsonResponse } from '@worker/index';
import { Hono } from 'hono';

const app = new Hono();
app.use('*', getCorsHonoMiddleware());

app.get('/', (c) => {
    return c.json({ message: 'Hello from Hyperintel Worker!' });
});

app.get('/api/health', (c) => {
    return createJsonResponse({ status: 'ok', timestamp: Date.now() });
});

app.onError((err, c) => {
    console.error(err);
    return createErrorResponse(err.message);
});

export default app;
