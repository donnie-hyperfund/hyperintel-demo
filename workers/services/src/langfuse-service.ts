import { createLangfuseClient, getLangfusePromptRaw } from '@/workers/_common/vendor/langfuse-prompts';

export interface GetLangfusePromptRawInput {
    promptName: string;
}

export type GetLangfusePromptRawResult =
    | {
          ok: true;
          prompt: string;
      }
    | {
          ok: false;
          message: string;
          code: string;
      };

let langfuseClientPromise: ReturnType<typeof createLangfuseClient> | null = null;

function getLangfuseClient(env: ServicesEnv) {
    langfuseClientPromise ??= createLangfuseClient(env);
    return langfuseClientPromise;
}

export async function getLangfusePromptRawRpc(
    input: GetLangfusePromptRawInput,
    env: ServicesEnv,
): Promise<GetLangfusePromptRawResult> {
    try {
        const prompt = await getLangfusePromptRaw(await getLangfuseClient(env), input.promptName, env);
        return { ok: true, prompt };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Failed to load Langfuse prompt',
            code: 'LANGFUSE_PROMPT_LOAD_FAILED',
        };
    }
}
