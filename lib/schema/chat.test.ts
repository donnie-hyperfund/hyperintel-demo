import { describe, expect, it } from 'vitest';
import { SendChatActionSchema } from './chat';

const BASE = { chatId: '00000000-0000-0000-0000-000000000001' };

describe('SendChatActionSchema', () => {
    describe('backward compatibility', () => {
        it('parses existing requests without new fields', () => {
            const result = SendChatActionSchema.safeParse({ ...BASE, message: 'hello' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.bypass_context_warning).toBeUndefined();
                expect(result.data.force_brief).toBeUndefined();
            }
        });

        it('parses nudge requests (message: null) without new fields', () => {
            const result = SendChatActionSchema.safeParse({ ...BASE, message: null });
            expect(result.success).toBe(true);
        });
    });

    describe('bypass_context_warning', () => {
        it('accepts bypass_context_warning: true with a normal message', () => {
            const result = SendChatActionSchema.safeParse({
                ...BASE,
                message: 'hi',
                bypass_context_warning: true,
            });
            expect(result.success).toBe(true);
        });

        it('accepts bypass_context_warning: true with message: null', () => {
            const result = SendChatActionSchema.safeParse({
                ...BASE,
                message: null,
                bypass_context_warning: true,
            });
            expect(result.success).toBe(true);
        });
    });

    describe('force_brief', () => {
        it('rejects force_brief: true when message is a non-null string', () => {
            const result = SendChatActionSchema.safeParse({
                ...BASE,
                message: 'hi',
                force_brief: true,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].path).toContain('force_brief');
            }
        });

        it('accepts force_brief: true when message is null', () => {
            const result = SendChatActionSchema.safeParse({
                ...BASE,
                message: null,
                force_brief: true,
            });
            expect(result.success).toBe(true);
        });

        it('accepts force_brief: true alongside bypass_context_warning: true when message is null', () => {
            const result = SendChatActionSchema.safeParse({
                ...BASE,
                message: null,
                force_brief: true,
                bypass_context_warning: true,
            });
            expect(result.success).toBe(true);
        });
    });
});
