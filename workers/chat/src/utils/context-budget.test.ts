import { ErrorStatus, PublicError } from '@common/common/error.helpers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextLimitError, estimateInferenceInputTokens } from './context-budget';

const estimateContextTokensMock = vi.fn();
const estimateTextTokensMock = vi.fn();
const estimateToolTokensMock = vi.fn();

vi.mock('@common/ai/utils', () => ({
    estimateContextTokens: (...args: unknown[]) => estimateContextTokensMock(...args),
    estimateTextTokens: (...args: unknown[]) => estimateTextTokensMock(...args),
    estimateToolTokens: (...args: unknown[]) => estimateToolTokensMock(...args),
}));

describe('context-budget', () => {
    beforeEach(() => {
        estimateContextTokensMock.mockReset();
        estimateTextTokensMock.mockReset();
        estimateToolTokensMock.mockReset();
    });

    it('estimates inference input tokens from instructions, context, and tools', () => {
        const context = [{ role: 'user' as const, content: 'hello' }];
        const processedContext = [{ role: 'user' as const, content: 'processed hello' }];
        const tools = [{ name: 'demo-tool' }];
        const toolGroups = [{ name: 'demo-group' }];

        estimateTextTokensMock.mockReturnValue(11);
        estimateContextTokensMock.mockReturnValue(22);
        estimateToolTokensMock.mockReturnValue({ total: 33 });

        const total = estimateInferenceInputTokens({
            instructions: 'system',
            context,
            tools,
            toolGroups: toolGroups as any,
            preprocessContext: () => processedContext,
        });

        expect(total).toBe(66);
        expect(estimateTextTokensMock).toHaveBeenCalledWith('system');
        expect(estimateContextTokensMock).toHaveBeenCalledWith(processedContext);
        expect(estimateToolTokensMock).toHaveBeenCalledWith(tools, toolGroups);
    });

    it('creates a structured context limit PublicError', () => {
        const error = createContextLimitError(191_000, 190_000, 'Too much context.');

        expect(error).toBeInstanceOf(PublicError);
        expect(error.statusCode).toBe(ErrorStatus.BadRequest);
        expect(error.code).toBe('CONTEXT_TOO_LONG');
        expect(error.message).toBe('Too much context.');
        expect(error.details).toEqual({
            estimatedTokens: 191_000,
            limitTokens: 190_000,
        });
    });
});
