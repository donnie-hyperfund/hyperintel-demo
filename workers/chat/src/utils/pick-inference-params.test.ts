import { AIParamsType, type ParamsWithType } from '@common/ai/inference';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { describe, expect, it } from 'vitest';
import { CHAT_CONTEXT_WARNING_TOKENS } from './context-budget';
import { pickInferenceParams } from './pick-inference-params';

const defaultInference: ParamsWithType = {
    paramsType: AIParamsType.OpenRouter,
    params: { model: 'openai/gpt-4o', searchEnabled: true } as any,
};

const overrideInference: ParamsWithType = {
    paramsType: AIParamsType.OpenRouter,
    params: { model: 'test/override', searchEnabled: false } as any,
};

const baseInput = {
    defaultInference,
    estimatedTokens: 0,
    bypassContextWarning: false,
    forceBrief: false,
    message: 'hi',
};

describe('pickInferenceParams', () => {
    it('uses defaultInference when below the warning threshold and no flags set', () => {
        const result = pickInferenceParams({ ...baseInput, estimatedTokens: 50_000 });
        expect(result.inferenceParams).toBe(defaultInference);
        expect(result.effectivePresetOverride).toBeUndefined();
    });

    it('switches to Sonnet 4.6 when estimatedTokens >= warning threshold', () => {
        const result = pickInferenceParams({ ...baseInput, estimatedTokens: CHAT_CONTEXT_WARNING_TOKENS });
        expect(result.inferenceParams.paramsType).toBe(AIParamsType.Anthropic);
        expect(result.inferenceParams.params.model).toBe(ANTHROPIC_MODELS.SONNET_4_6);
        expect(result.effectivePresetOverride).toBe('sonnet-4.6');
    });

    it('switches to Sonnet 4.6 when bypassContextWarning is true even at low tokens', () => {
        const result = pickInferenceParams({
            ...baseInput,
            estimatedTokens: 10_000,
            bypassContextWarning: true,
        });
        expect(result.inferenceParams.params.model).toBe(ANTHROPIC_MODELS.SONNET_4_6);
        expect(result.effectivePresetOverride).toBe('sonnet-4.6');
    });

    it('switches to Sonnet 4.6 when forceBrief is true even at low tokens', () => {
        const result = pickInferenceParams({
            ...baseInput,
            estimatedTokens: 10_000,
            forceBrief: true,
        });
        expect(result.inferenceParams.params.model).toBe(ANTHROPIC_MODELS.SONNET_4_6);
        expect(result.effectivePresetOverride).toBe('sonnet-4.6');
    });

    it('switches to Sonnet 4.6 when message matches CB intent at low tokens', () => {
        const result = pickInferenceParams({
            ...baseInput,
            estimatedTokens: 10_000,
            message: 'please generate the completion brief',
        });
        expect(result.inferenceParams.params.model).toBe(ANTHROPIC_MODELS.SONNET_4_6);
        expect(result.effectivePresetOverride).toBe('sonnet-4.6');
    });

    it('does not switch on a benign low-context message that does not match CB intent', () => {
        const result = pickInferenceParams({
            ...baseInput,
            estimatedTokens: 10_000,
            message: 'tell me a joke',
        });
        expect(result.inferenceParams).toBe(defaultInference);
        expect(result.effectivePresetOverride).toBeUndefined();
    });

    it('handles null and undefined messages without throwing', () => {
        const nullResult = pickInferenceParams({ ...baseInput, message: null });
        expect(nullResult.inferenceParams).toBe(defaultInference);
        const undefResult = pickInferenceParams({ ...baseInput, message: undefined });
        expect(undefResult.inferenceParams).toBe(defaultInference);
    });

    it('overrideInference always wins, regardless of high context', () => {
        const result = pickInferenceParams({
            ...baseInput,
            estimatedTokens: 250_000,
            bypassContextWarning: true,
            forceBrief: true,
            overrideInference,
        });
        expect(result.inferenceParams).toBe(overrideInference);
        expect(result.effectivePresetOverride).toBeUndefined();
    });

    it('overrideInference suppresses effectivePresetOverride even when Sonnet would otherwise fire', () => {
        const result = pickInferenceParams({
            ...baseInput,
            estimatedTokens: 200_000,
            overrideInference,
        });
        expect(result.inferenceParams).toBe(overrideInference);
        expect(result.effectivePresetOverride).toBeUndefined();
    });
});
