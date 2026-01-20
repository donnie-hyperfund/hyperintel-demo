import Anthropic from '@anthropic-ai/sdk';
import { backendEnv } from '@/app/api/env';

export const anthropic = new Anthropic({
    apiKey: backendEnv.ANTHROPIC_API_KEY,
    defaultHeaders: {
        'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
    },
});
