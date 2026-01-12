import { backendEnv } from '@/app/api/env';
import OpenAI from 'openai';
import { observeOpenAI } from 'langfuse';
import { LangfuseExtension } from '@worker/vendor/openai';

const client = new OpenAI({
    apiKey: backendEnv.OPENAI_API_KEY,
});
export const openai = (
    backendEnv.LANGFUSE_HOST &&
    backendEnv.LANGFUSE_PUBLIC_KEY &&
    backendEnv.LANGFUSE_SECRET_KEY
        ? observeOpenAI(client)
        : client
) as LangfuseExtension;
