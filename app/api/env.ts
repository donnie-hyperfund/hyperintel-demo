import { z } from 'zod';

const envBackendSchema = z.object({
    // Main
    DATABASE_URL: z.string().min(1),
    CLERK_SECRET_KEY: z.string(),
    CLERK_WEBHOOK_SECRET: z.string(),

    // AI Providers
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CEREBRAS_API_KEY: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    // AI Tools
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_HOST: z.string().min(1).optional(),
    LANGFUSE_ENVIRONMENT: z.enum(['Development', 'Production']).optional(),

    //LANGSMITH_API_KEY: z.string().min(1).optional(),
    //LANGSMITH_HOST: z.string().min(1).optional(),

    // Misc
    DATABASE_USE_SSL: z.coerce.boolean().optional().default(true),
});

const parsedBackendEnv = envBackendSchema.safeParse(process.env);

// TODO don't throw on workers.
if (!parsedBackendEnv.success) {
    console.error('❌ Invalid environment variables:', parsedBackendEnv.error.format());
    throw new Error('Invalid environment variables');
}

export const backendEnv = parsedBackendEnv.data;
