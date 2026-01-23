import { LangfuseExtension } from '@worker/vendor/openai';
import { observeOpenAI } from 'langfuse';
import OpenAI from 'openai';
import { backendEnv } from '@/app/api/env';

const client = new OpenAI({
    apiKey: backendEnv.OPENAI_API_KEY ?? 'MISSING-OPENAI-API-KEY',
});
export const openai = (
    backendEnv.LANGFUSE_HOST && backendEnv.LANGFUSE_PUBLIC_KEY && backendEnv.LANGFUSE_SECRET_KEY
        ? observeOpenAI(client)
        : client
) as LangfuseExtension;
