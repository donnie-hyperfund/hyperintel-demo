import { expandToAnthropicMessages } from '@common/ai/inference/expanders/anthropic';
import { describe, expect, it, vi } from 'vitest';
import { INTERLEAVE_ARTIFACT_IMAGE_CONTENT_PARTS } from '@/lib/markdown/artifact-images';

vi.mock('@/lib/artifacts/artifact-images', () => ({
    signArtifactImageKeys: vi.fn((_env: unknown, keys: string[]) => {
        const map = new Map<string, string>();
        for (const key of keys) {
            map.set(key, `https://signed.example/${key}`);
        }
        return Promise.resolve(map);
    }),
}));

vi.mock('../uploads/image-uploader', () => ({
    generateSignedImageUrls: vi.fn(() => Promise.resolve(new Map())),
}));

import { loadChatHistory } from './stream-utils';

describe('loadChatHistory', () => {
    it('reconstructs toolContentParts from persisted toolImageRefs in chat history', async () => {
        const dbMessages = [
            {
                id: 'msg-1',
                role: 'assistant',
                content: '',
                is_error: false,
                is_aborted: false,
                blocks: [
                    {
                        type: 'tool_call',
                        toolName: 'read_document',
                        toolCallId: 'tool-1',
                        content: 'tool output block',
                        toolOutput:
                            '# Report\n\n![Chart](artifact-image://uploads/project/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/images/chart.png)',
                        toolImageRefs: [
                            'artifact-image://uploads/project/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/images/chart.png',
                        ],
                    },
                ],
            },
        ];

        const em = {
            createQueryBuilder: vi.fn(() => ({
                select: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                getResult: vi.fn().mockResolvedValue(dbMessages),
            })),
            find: vi.fn().mockResolvedValue([]),
        };

        const history = await loadChatHistory(em as any, 'chat-1', {} as Env);

        expect(history).toHaveLength(1);
        expect(history[0].role).toBe('assistant');
        expect(history[0]).toHaveProperty('blocks');

        const toolBlock = (history[0] as any).blocks[0];
        if (INTERLEAVE_ARTIFACT_IMAGE_CONTENT_PARTS) {
            expect(toolBlock.toolContentParts).toEqual([
                {
                    type: 'text',
                    text: '# Report\n\n',
                },
                {
                    type: 'image',
                    source: 'url',
                    url: 'https://signed.example/uploads/project/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/images/chart.png',
                    mediaType: 'image/png',
                },
            ]);
        } else {
            expect(toolBlock.toolContentParts).toEqual([
                {
                    type: 'text',
                    text: '# Report\n\n![Chart](artifact-image://uploads/project/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/images/chart.png)',
                },
                {
                    type: 'image',
                    source: 'url',
                    url: 'https://signed.example/uploads/project/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/images/chart.png',
                    mediaType: 'image/png',
                },
            ]);
        }
    });

    it('preserves turnIndex on loaded blocks for Anthropic expansion', async () => {
        const dbMessages = [
            {
                id: 'msg-1',
                role: 'assistant',
                content: '',
                is_error: false,
                is_aborted: false,
                blocks: [
                    {
                        id: 'reasoning-1',
                        type: 'reasoning',
                        source: 'anthropic',
                        content: 'thinking',
                        thinkingSignature: 'sig-1',
                        turnIndex: 3,
                    },
                    {
                        id: 'tool-1',
                        type: 'tool_call',
                        toolName: 'read_document',
                        toolCallId: 'toolu_a',
                        toolInput: { name: 'a' },
                        content: 'result a',
                        toolOutput: 'result a',
                        turnIndex: 3,
                    },
                    {
                        id: 'tool-2',
                        type: 'tool_call',
                        toolName: 'read_document',
                        toolCallId: 'toolu_b',
                        toolInput: { name: 'b' },
                        content: 'result b',
                        toolOutput: 'result b',
                        turnIndex: 3,
                    },
                ],
            },
        ];

        const em = {
            createQueryBuilder: vi.fn(() => ({
                select: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                getResult: vi.fn().mockResolvedValue(dbMessages),
            })),
            find: vi.fn().mockResolvedValue([]),
        };

        const history = await loadChatHistory(em as any, 'chat-1', {} as Env);

        expect((history[0] as any).blocks.map((block: any) => block.turnIndex)).toEqual([3, 3, 3]);
        expect(expandToAnthropicMessages(history[0] as any, 'omit')).toEqual([
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'thinking', signature: 'sig-1' },
                    { type: 'tool_use', id: 'toolu_a', name: 'read_document', input: { name: 'a' } },
                    { type: 'tool_use', id: 'toolu_b', name: 'read_document', input: { name: 'b' } },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'toolu_a', content: 'result a', is_error: false },
                    { type: 'tool_result', tool_use_id: 'toolu_b', content: 'result b', is_error: false },
                ],
            },
        ]);
    });
});
