import { z } from 'zod';

const envBackendSchema = z.object({
    // Main
    DATABASE_URL: z.string().min(1),
    CLERK_SECRET_KEY: z.string(),
    CLERK_WEBHOOK_SECRET: z.string(),
});

const parsedBackendEnv = envBackendSchema.safeParse(process.env);

// TODO don't throw on workers.
if (!parsedBackendEnv.success) {
    console.error('❌ Invalid environment variables:', parsedBackendEnv.error.format());
    throw new Error('Invalid environment variables');
}

export const backendEnv = parsedBackendEnv.data;
