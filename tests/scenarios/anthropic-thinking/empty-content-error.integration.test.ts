import path from 'node:path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { expandToAnthropicMessages } from '@common/ai/inference/expanders/anthropic';
import type { RichContextMessage } from '@common/ai/inference/types';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../../.env.test'), override: true });

const apiKey = process.env.ANTHROPIC_API_KEY;

/**
 * Production failure (dev chat 196c0eab-...): an assistant message whose
 * only block is `terminal_tool` and whose `content` is empty. The expander's
 * terminal_tool case is a no-op, the loop emits nothing, and the final
 * `result.length === 0` fallback returns `{role:'assistant', content: ''}`,
 * which Anthropic rejects with "text content blocks must be non-empty".
 */
function terminalToolOnlyMessage(): RichContextMessage {
    return {
        role: 'assistant',
        content: '',
        blocks: [
            {
                id: 'toolu_01GE7k69RLLZi15NgiyGGdy4',
                type: 'terminal_tool',
                content: '{"reason":"Phase 7 complete — authorized phase transition."}',
                toolName: 'start_phase_transition',
                toolInput: { reason: 'Phase 7 complete — authorized phase transition.' },
                turnIndex: 0,
                toolCallId: 'toolu_01GE7k69RLLZi15NgiyGGdy4',
            },
        ],
    };
}

describe.skipIf(!apiKey)('Anthropic empty assistant content repro', () => {
    it('rejects an assistant message with an empty text content block', async () => {
        // Pipeline produces this shape: expander returns `{role:'assistant', content: ''}`,
        // then `tagMessageContent` wraps the string into `[{type:'text', text:''}]`,
        // and Anthropic rejects the empty text block.
        const anthropic = new Anthropic({ apiKey });
        const messages = [
            { role: 'user' as const, content: 'Hello.' },
            { role: 'assistant' as const, content: [{ type: 'text' as const, text: '' }] },
            { role: 'user' as const, content: 'Continue.' },
        ];

        try {
            await anthropic.messages.create({
                model: ANTHROPIC_MODELS.SONNET_4_6,
                max_tokens: 256,
                messages,
            });
            throw new Error('Expected Anthropic to reject the empty-content assistant message.');
        } catch (error: any) {
            const message = error?.error?.error?.message ?? error?.message ?? '';
            expect(error?.status).toBe(400);
            expect(message).toContain('text content blocks must be non-empty');
        }
    });

    it('drops a terminal_tool-only assistant message via the expander', async () => {
        const expanded = expandToAnthropicMessages(terminalToolOnlyMessage(), 'omit');
        expect(expanded).toEqual([]);

        const anthropic = new Anthropic({ apiKey });
        const response = await anthropic.messages.create({
            model: ANTHROPIC_MODELS.SONNET_4_6,
            max_tokens: 256,
            messages: [
                { role: 'user' as const, content: 'Hello.' },
                ...expanded,
                { role: 'user' as const, content: 'Continue.' },
            ],
        });

        expect(response.id).toMatch(/^msg_/);
    }, 30_000);
});
