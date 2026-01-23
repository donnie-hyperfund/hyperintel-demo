import { Langfuse } from 'langfuse';
import {
    type GetPromptOptions,
    type LangfuseConfig,
    LangfuseError,
    type LangfusePrompt,
    PromptEnvironment,
} from './types';

export class LangfuseClient {
    private client: Langfuse | null = null;
    private config: LangfuseConfig | null = null;
    private defaultEnvironment: PromptEnvironment = PromptEnvironment.Production;

    constructor(config?: LangfuseConfig) {
        if (config) {
            this.initialize(config);
        }
    }

    initialize(config: LangfuseConfig): void {
        if (!config.secretKey || !config.publicKey || !config.baseUrl) {
            throw new LangfuseError('Langfuse configuration is incomplete. Missing secretKey, publicKey, or baseUrl.');
        }

        this.config = config;
        this.defaultEnvironment = config.defaultEnvironment ?? PromptEnvironment.Production;
        this.client = new Langfuse({
            secretKey: config.secretKey,
            publicKey: config.publicKey,
            baseUrl: config.baseUrl,
        });
    }

    isInitialized(): boolean {
        return this.client !== null && this.config !== null;
    }

    async getPrompt(
        promptName: string,
        environment?: PromptEnvironment,
        options: GetPromptOptions = {},
    ): Promise<LangfusePrompt> {
        if (!this.isInitialized()) {
            throw new LangfuseError(
                'Langfuse client is not initialized. Call initialize() first or provide config in constructor.',
            );
        }

        const { params = {}, cacheTtlSeconds = 300 } = options;

        const env = environment ?? this.defaultEnvironment;

        try {
            const prompt = await this.client!.getPrompt(promptName, undefined, {
                cacheTtlSeconds,
                label: env,
            });

            const stringParams = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
            const compiledPrompt = prompt.compile(stringParams);

            return {
                name: promptName,
                prompt: compiledPrompt,
                environment: env,
                version: prompt.version,
            };
        } catch (error) {
            throw new LangfuseError(
                `Failed to fetch prompt "${promptName}" with environment "${env}": ${error instanceof Error ? error.message : String(error)}`,
                error,
            );
        }
    }

    async flush(): Promise<void> {
        if (!this.isInitialized()) {
            return;
        }

        try {
            await this.client!.flushAsync();
        } catch (error) {
            console.error('Failed to flush Langfuse events:', error);
        }
    }

    async shutdown(): Promise<void> {
        if (!this.isInitialized()) {
            return;
        }

        try {
            await this.client!.shutdownAsync();
        } catch (error) {
            console.error('Failed to shutdown Langfuse client:', error);
        }
    }
}
