import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'

export const getCorsHonoMiddleware = () => cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
    credentials: true,
})
