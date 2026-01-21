import { LangfuseClient } from './client';
import { LangfuseError, PromptEnvironment } from './types';

export { LangfuseClient, LangfuseError, PromptEnvironment };
export type {
    GetPromptOptions,
    LangfuseConfig,
    LangfusePrompt,
} from './types';

export function createLangfuseClient(): LangfuseClient | null {
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const baseUrl = process.env.LANGFUSE_HOST;
    const environment = process.env.LANGFUSE_ENVIRONMENT;

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
