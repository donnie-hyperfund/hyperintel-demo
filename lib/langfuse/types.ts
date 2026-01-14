export enum PromptEnvironment {
    Development = 'Development',
    Production = 'Production',
}

export interface LangfuseConfig {
    secretKey: string;
    publicKey: string;
    baseUrl: string;
    defaultEnvironment?: PromptEnvironment;
}

export interface GetPromptOptions {
    params?: Record<string, string | number | boolean>;
    cacheTtlSeconds?: number;
}

export interface LangfusePrompt {
    name: string;
    prompt: string;
    environment: PromptEnvironment;
    version?: number;
}

export class LangfuseError extends Error {
    public readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'LangfuseError';
        this.cause = cause;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, LangfuseError);
        }
    }
}
