import { describe, expect, it } from 'vitest';
import { isOutputSafetyEnabled } from '@/workers/chat/src/safety/config';

describe('output safety flag', () => {
    it('defaults to enabled when unset', () => {
        expect(isOutputSafetyEnabled({})).toBe(true);
    });

    it('treats false-like values as disabled', () => {
        expect(isOutputSafetyEnabled({ CHAT_OUTPUT_SAFETY_ENABLED: 'false' })).toBe(false);
        expect(isOutputSafetyEnabled({ CHAT_OUTPUT_SAFETY_ENABLED: '0' })).toBe(false);
        expect(isOutputSafetyEnabled({ CHAT_OUTPUT_SAFETY_ENABLED: 'off' })).toBe(false);
    });

    it('keeps output safety enabled for other values', () => {
        expect(isOutputSafetyEnabled({ CHAT_OUTPUT_SAFETY_ENABLED: 'true' })).toBe(true);
        expect(isOutputSafetyEnabled({ CHAT_OUTPUT_SAFETY_ENABLED: 'yes' })).toBe(true);
    });
});
