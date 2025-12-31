import { Hono } from 'hono'
import { createJsonResponse, createErrorResponse } from '@worker/index'
import { getCorsHonoMiddleware } from '@worker/cors.helpers'

const app = new Hono()
app.use('*', getCorsHonoMiddleware())

app.get('/', (c) => {
    return c.json({ message: 'Hello from Hyperintel Worker!' })
})

app.get('/api/health', (c) => {
    return createJsonResponse({ status: 'ok', timestamp: Date.now() })
})

app.onError((err, c) => {
    console.error(err)
    return createErrorResponse(err.message)
})

export default app
