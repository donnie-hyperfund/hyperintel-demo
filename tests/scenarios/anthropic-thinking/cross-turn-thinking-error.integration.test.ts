import path from 'node:path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS } from '@common/ai/types';
import { expandToAnthropicMessages } from '@common/ai/inference/expanders/anthropic';
import type { RichContextMessage } from '@common/ai/inference/types';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../../.env.test'), override: true });

const apiKey = process.env.ANTHROPIC_API_KEY;

// Reused real Anthropic signatures + matching thinking content from the
// same-turnIndex test fixture. Signatures attest to the thinking content only,
// so they can be replayed in any structural arrangement as long as the
// thinking field is byte-identical.
const thinkingSignature1 =
    'EtsCClsIDRgCKkDN4OHlJRtS2w/oWuge5CBqHFH+KZGXANlWW7AKrrudchWb3Rnzzbzpg2c+HDx407z19R8JhIL5tsG1aaDDgQKqMhFjbGF1ZGUtc29ubmV0LTQtNjgAEgyNQvBUC801SQgjBdwaDC537/lnPMLXe+pc6iIwQhUrkWOD2Vlw+fD/ngOqy5qBq7SidwxzrIAwFC8rJ9+/w94OcXBSHOsM+Q31Ke9uKq0BhhGAMGTNjJP8Ld76/l/tmHGLDK0MD0SHKSiWFSvTC105A1kGb8hbhGM6EybMWNRo3pLtelkCPVhup8V1gqUF1J8GuCr13fdWWxuNl7md/9JG39AxVpbm76pst+pebJA806MvUwhZPLmc56h43skNJYM92StBW1dPdw1d2k5mExPXtlmNeW9l7W7Bbu+ok53Pj+36Nrrz2zOCxsa2i10YHuZvR/MKUzxI+j88hV4YAQ==';
const thinkingContent1 =
    'Now I need to write the clean content. I will use patch_document, but this response produced no visible content or tool call.';

const thinkingSignature2 =
    'Er4CClsIDRgCKkDuUHnlr8pZ4PjURD9G1SdwNx9XH7EXrE+rxzGDp7cn10Le002E9sTTX8xbqKaH8DZQ8p2TE3XSF/+jR94mrZzWMhFjbGF1ZGUtc29ubmV0LTQtNjgAEgyNIsl08mvy2lLAKlAaDCU+c0WlWVZXSMx+YiIw75HzH0TmwuOJDUUfhW1KpnQT0etEhd/aI/lxlQQ4Y9wpuuAWzSbN/HEkdwn0RLsdKpABOybaCOXOo/gN+AL2QpGej64jvQ0jGAFwrZjy8xLMJkFqZhrdqizuuibDqRCGWQt7u+EFYTllBrMz29M6B82gq1Mel04I7M9cdvSWwe505pzDFFleMKSF6hb6LWMxUQt8VkkrE00FfXGL3+bkzP3kDaPtfy5rRDm/pffeiBI++a9oDx4TZYyl5X3ONxbqwqdSGAE=';
const thinkingContent2 =
    "I have an open document draft that needs to be finalized. Let me call finalize_document immediately to save it before it's lost.";

const toolCallId = 'toolu_01J5q6Cvt4tAEf4eEL4FaQGJ';
const toolOutput =
    '{"action":"proposed","name":"cn-10-section-3-2-peer-benchmark.md","version":11,"status":"proposed","lines":512,"supersededVersion":10}';

/**
 * Mirrors the production shape from chat 20c5c213-...: an assistant turn
 * whose buffer carries earlier text PLUS a trailing signed thinking, followed
 * by a fresh turn that ALSO begins with signed thinking. When the expander
 * forgets to insert a separator, Anthropic's merge collapses the two
 * consecutive assistant messages into one with adjacent signed thinkings.
 */
function crossTurnBlocks(): RichContextMessage {
    return {
        role: 'assistant',
        content: '',
        blocks: [
            {
                id: 'text-0',
                type: 'text',
                content: 'Reviewing the document now.',
                turnIndex: 0,
            },
            {
                id: 'reasoning-0',
                type: 'reasoning',
                source: 'anthropic',
                content: thinkingContent1,
                thinkingSignature: thinkingSignature1,
                turnIndex: 0,
            },
            {
                id: 'reasoning-1',
                type: 'reasoning',
                source: 'anthropic',
                content: thinkingContent2,
                thinkingSignature: thinkingSignature2,
                turnIndex: 1,
            },
            {
                id: toolCallId,
                type: 'tool_call',
                content: toolOutput,
                toolName: 'finalize_document',
                toolInput: {},
                toolCallId,
                toolOutput,
                toolSuccess: true,
                turnIndex: 1,
            },
        ],
    };
}

/**
 * The bad shape the pre-fix expander would have produced — two consecutive
 * assistant messages where the first ends in a signed thinking and the second
 * starts with one. Anthropic merges them and rejects the adjacent thinkings.
 */
function preRepairBadMessages() {
    return [
        {
            role: 'assistant' as const,
            content: [
                { type: 'text' as const, text: 'Reviewing the document now.' },
                { type: 'thinking' as const, thinking: thinkingContent1, signature: thinkingSignature1 },
            ],
        },
        {
            role: 'assistant' as const,
            content: [
                { type: 'thinking' as const, thinking: thinkingContent2, signature: thinkingSignature2 },
                { type: 'tool_use' as const, id: toolCallId, name: 'finalize_document', input: {} },
            ],
        },
        {
            role: 'user' as const,
            content: [
                { type: 'tool_result' as const, tool_use_id: toolCallId, content: toolOutput, is_error: false },
            ],
        },
    ];
}

const finalizeTool = {
    name: 'finalize_document',
    description: 'Finalize the current document draft.',
    input_schema: { type: 'object' as const, properties: {}, additionalProperties: false },
};

describe.skipIf(!apiKey)('Anthropic signed thinking cross-turn repro', () => {
    it('rejects the pre-fix expander shape (text + trailing signed thinking, then fresh signed thinking)', async () => {
        const anthropic = new Anthropic({ apiKey });
        const messages = [
            { role: 'user' as const, content: 'Reload C-10 and surgically remediate changes.' },
            ...preRepairBadMessages(),
            { role: 'user' as const, content: 'Continue.' },
        ];

        try {
            await anthropic.beta.messages.create({
                model: ANTHROPIC_MODELS.SONNET_4_6,
                max_tokens: 1024,
                thinking: { type: 'enabled', budget_tokens: 1024 },
                betas: ['interleaved-thinking-2025-05-14'],
                tools: [finalizeTool],
                messages,
            });
            throw new Error('Expected Anthropic to reject the cross-turn thinking shape.');
        } catch (error: any) {
            const message = error?.error?.error?.message ?? error?.message ?? '';
            expect(error?.status).toBe(400);
            expect(message).toContain('thinking');
            expect(message).toContain('latest assistant message cannot be modified');
        }
    });

    it('accepts the same blocks after the expander inserts a [Truncated] separator', async () => {
        const anthropic = new Anthropic({ apiKey });
        const expanded = expandToAnthropicMessages(crossTurnBlocks(), 'omit');

        expect(expanded).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Reviewing the document now.' },
                    { type: 'thinking', thinking: thinkingContent1, signature: thinkingSignature1 },
                    { type: 'text', text: '[Truncated]' },
                ],
            },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: thinkingContent2, signature: thinkingSignature2 },
                    { type: 'tool_use', id: toolCallId, name: 'finalize_document', input: {} },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: toolCallId, content: toolOutput, is_error: false },
                ],
            },
        ]);

        const response = await anthropic.beta.messages.create({
            model: ANTHROPIC_MODELS.SONNET_4_6,
            max_tokens: 1024,
            thinking: { type: 'enabled', budget_tokens: 1024 },
            betas: ['interleaved-thinking-2025-05-14'],
            tools: [finalizeTool],
            messages: [
                { role: 'user' as const, content: 'Reload C-10 and surgically remediate changes.' },
                ...expanded,
                { role: 'user' as const, content: 'Continue.' },
            ],
        });

        expect(response.id).toMatch(/^msg_/);
    }, 30_000);
});
