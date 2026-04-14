import { z } from 'zod';

const envFrontendSchema = z.object({
    NEXT_PUBLIC_APP_ENV: z.enum(['development', 'production']).default('development'),
    NEXT_PUBLIC_BASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
    // NEXT_PUBLIC_VERCEL_URL: z.string().optional(),
    NEXT_PUBLIC_CLOUDFLARE_BASE: z.string().optional(),
    NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV: z.string().optional(),
    NEXT_PUBLIC_CLOUDFLARE_ALIAS: z.string().optional(),
    NEXT_PUBLIC_LOCAL_WORKERS: z.coerce.boolean().optional().default(false),
});

const parsedFrontendEnv = envFrontendSchema.safeParse({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    // NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_CLOUDFLARE_BASE: process.env.NEXT_PUBLIC_CLOUDFLARE_BASE,
    NEXT_PUBLIC_LOCAL_WORKERS: process.env.NEXT_PUBLIC_LOCAL_WORKERS === 'true',
    NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV: process.env.NEXT_PUBLIC_CLOUDFLARE_WORKER_ENV,
    NEXT_PUBLIC_CLOUDFLARE_ALIAS: process.env.NEXT_PUBLIC_CLOUDFLARE_ALIAS,
});

if (!parsedFrontendEnv.success) {
    console.error('❌ Invalid environment variables:', parsedFrontendEnv.error.format());
    throw new Error('Invalid environment variables');
}

export const frontendEnv = parsedFrontendEnv.data;
