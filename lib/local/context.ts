/**
 * Generic context factory for running ANY worker locally in Next.js.
 * 
 * Usage - types are inferred from projectDeps:
 * ```ts
 * const ctx = await initNextjsWorkerContext();                    // full context
 * const ctx = await initNextjsWorkerContext({ skipAuth: true });  // no user
 * const ctx = await initNextjsWorkerContext({ optionalAuth: true }); // user | null
 * ```
 */

import { createContextFactory, ContextConfig, ContextDependencies, InferredLocalContext } from '@common/common/local.helpers';
import { getOrm } from '@/lib/orm';
import { openai } from '@/lib/vendor/openai';
import { anthropic } from '@/lib/vendor/anthropic';
import { orouter, orouterSdk } from '@/lib/vendor/openrouter';
import { envSecretMocks } from '@/lib/local/cf-env-secret-mock';
import { assertAuth } from '@/lib/api/auth-guard';
import type { ClerkUser } from '@/lib/types/clerk';
// For worker Ctx compatibility
import { createClerkClient } from '@clerk/backend';
import { Langfuse } from 'langfuse';
import type postgres from 'postgres';
import { waitUntil } from '@vercel/functions';

/**
 * Pre-configured dependencies for this project.
 * satisfies gives autocomplete + preserves literal types for inference.
 */
const projectDeps = {
    auth: 'clerk',
    database: 'orm',
    clerkAuth: { getAuth: assertAuth },
    getOrm,
    openai,
    anthropic,
    orouter,
    orouterSdk,
    envSecretMocks,
    // Worker Ctx compatibility - these satisfy the type even if unused
    clerk: createClerkClient({
        secretKey: process.env.CLERK_SECRET_KEY!,
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!,
    }),
    langfuse: new Langfuse({
        secretKey: process.env.LANGFUSE_SECRET_KEY!,
        publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
        baseUrl: process.env.LANGFUSE_HOST,
    }),
    sql: null as unknown as postgres.Sql,
    eCtx: { waitUntil },
} satisfies ContextDependencies<ClerkUser>;

/**
 * Context factory with inferred types - no explicit generic needed.
 */
export const initNextjsWorkerContext = createContextFactory(projectDeps);

// Type alias for common use
export type ProjectContext = InferredLocalContext<typeof projectDeps>;

export type { ContextConfig };

