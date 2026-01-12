import { backendEnv } from '@/app/api/env';
import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic({
    apiKey: backendEnv.ANTHROPIC_API_KEY,
});
