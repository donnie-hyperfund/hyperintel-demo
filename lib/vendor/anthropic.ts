import Anthropic from '@anthropic-ai/sdk';
import { backendEnv } from '@/app/api/env';

export const anthropic = new Anthropic({
    apiKey: backendEnv.ANTHROPIC_API_KEY,
});
