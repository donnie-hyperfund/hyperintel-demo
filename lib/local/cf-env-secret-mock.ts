import { backendEnv } from '@/app/api/env';
import { makeSecretMock } from '@common/common/local.helpers';

/**
 * Mock env that matches the worker's Env type.
 * Provides all properties expected by InferredContext<Env>.
 */
export const envSecretMocks = {
    // Secrets (SecretsStoreSecret interface)
    OPENROUTER_API_KEY: makeSecretMock(backendEnv.OPENROUTER_API_KEY!),
    CF_TOKEN: makeSecretMock('TODO'), // backendEnv.CF_GATEWAY_TOKEN!
    ANTHROPIC_API_KEY: makeSecretMock(backendEnv.ANTHROPIC_API_KEY ?? ''),
    DATABASE_URL: makeSecretMock(process.env.DATABASE_URL ?? ''),
    CLERK_SECRET_KEY: makeSecretMock(process.env.CLERK_SECRET_KEY ?? ''),
    LANGFUSE_SECRET_KEY: makeSecretMock(backendEnv.LANGFUSE_SECRET_KEY!),
    AUTH_SECRET: makeSecretMock(process.env.AUTH_SECRET ?? ''),
    // Non-secrets (plain strings)
    CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
    LANGFUSE_ENVIRONMENT: process.env.LANGFUSE_ENVIRONMENT ?? 'Development',
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    LANGFUSE_HOST: process.env.LANGFUSE_HOST ?? '',
    ENV: process.env.NODE_ENV === 'production' ? 'production' : 'dev',
    CORS_ALLOWED_ORIGIN: '*',
};

