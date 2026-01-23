import { backendEnv } from '@/app/api/env';
import { LangfuseClient } from './client';
import { LangfuseError, PromptEnvironment } from './types';

export { LangfuseClient, LangfuseError, PromptEnvironment };
export type {
    GetPromptOptions,
    LangfuseConfig,
    LangfusePrompt,
} from './types';

export function createLangfuseClient(): LangfuseClient | null {
    const secretKey = backendEnv.LANGFUSE_SECRET_KEY;
    const publicKey = backendEnv.LANGFUSE_PUBLIC_KEY;
    const baseUrl = backendEnv.LANGFUSE_HOST;
    const environment = backendEnv.LANGFUSE_ENVIRONMENT;

    if (!secretKey || !publicKey || !baseUrl) {
        console.warn(
            'Langfuse configuration is missing. Set LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, and LANGFUSE_HOST environment variables.',
        );
        return null;
    }

    const defaultEnvironment =
        environment === 'Development'
            ? PromptEnvironment.Development
            : environment === 'Production'
              ? PromptEnvironment.Production
              : undefined;

    const client = new LangfuseClient({
        secretKey,
        publicKey,
        baseUrl,
        defaultEnvironment,
    });

    return client;
}

let langfuseClientInstance: LangfuseClient | null = null;

export function getLangfuseClient(): LangfuseClient | null {
    if (!langfuseClientInstance) {
        langfuseClientInstance = createLangfuseClient();
    }
    return langfuseClientInstance;
}
