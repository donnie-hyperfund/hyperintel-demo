import { backendEnv } from '@/app/api/env';
import OpenAI from 'openai';
import { observeOpenAI } from 'langfuse';
import { LangfuseExtension } from '@worker/vendor/openrouter';
import { OpenRouter } from '@openrouter/sdk';


const BASE_OR = 'https://openrouter.ai/api/v1';

const client = new OpenAI({
    baseURL: BASE_OR,
    apiKey: backendEnv.OPENROUTER_API_KEY,
});

// Create orouter with orig property to match worker's LangfuseExtension type
const orouterBase = (
    backendEnv.LANGFUSE_HOST &&
    backendEnv.LANGFUSE_PUBLIC_KEY &&
    backendEnv.LANGFUSE_SECRET_KEY
        ? observeOpenAI(client)
        : client
) as LangfuseExtension;
// Add orig property required by worker's InferredContext
(orouterBase as any).orig = client;
export const orouter = orouterBase;

export const orouterSdk = new OpenRouter({
    apiKey: backendEnv.OPENROUTER_API_KEY,
});

