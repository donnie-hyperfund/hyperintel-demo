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

import { createPusher, loadChatHistory, persistErrorMessage } from './stream-utils';

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

describe('persistErrorMessage', () => {
    it('fills classified error metadata into an existing empty assistant placeholder', async () => {
        const existing = {
            content: '',
            reasoning: null,
            blocks: [],
            is_error: true,
            metadata: null,
            debug_data: null,
        };
        const chat = { active_agent_message_id: 'agent-1' };
        const em = {
            findOne: vi.fn().mockResolvedValue(existing),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        await persistErrorMessage({
            em,
            chatId: 'chat-1',
            agentMessageId: 'agent-1',
            chat,
            error: new Error('response ended'),
            errorMetadata: { code: 'INCOMPLETE_RESPONSE', retryable: true, referenceId: 'ref-1' },
            label: 'test',
        });

        expect(existing.is_error).toBe(true);
        expect(existing.metadata).toEqual({
            error: { code: 'INCOMPLETE_RESPONSE', retryable: true, referenceId: 'ref-1' },
        });
        expect((existing.debug_data as any).error.message).toBe('response ended');
        expect(chat.active_agent_message_id).toBeNull();
        expect(em.flush).toHaveBeenCalledOnce();
    });

    it('does not mark an already-persisted assistant payload as an error', async () => {
        const existing = {
            content: 'completed response',
            reasoning: null,
            blocks: null,
            is_error: false,
            metadata: { preset: 'sonnet' },
            debug_data: null,
        };
        const chat = { active_agent_message_id: 'agent-1' };
        const em = {
            findOne: vi.fn().mockResolvedValue(existing),
            flush: vi.fn().mockResolvedValue(undefined),
        };

        await persistErrorMessage({
            em,
            chatId: 'chat-1',
            agentMessageId: 'agent-1',
            chat,
            error: new Error('late cleanup failed'),
            errorMetadata: { code: 'UNKNOWN', retryable: true, referenceId: 'ref-2' },
            label: 'test',
        });

        expect(existing.is_error).toBe(false);
        expect(existing.metadata).toEqual({ preset: 'sonnet' });
        expect(existing.debug_data).toBeNull();
        expect(chat.active_agent_message_id).toBeNull();
        expect(em.flush).toHaveBeenCalledOnce();
    });
});

describe('createPusher', () => {
    it('waits only for pushes still in flight', async () => {
        let releaseFirst!: () => void;
        let releaseSecond!: () => void;
        const first = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const second = new Promise<void>((resolve) => {
            releaseSecond = resolve;
        });
        const push = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
        const pusher = createPusher({ push } as any, 'test');

        pusher.push([{ type: 'status_update', status: 'first' }]);
        expect(push).toHaveBeenLastCalledWith([{ type: 'status_update', status: 'first' }], 0);

        releaseFirst();
        await pusher.waitAll();

        pusher.push([{ type: 'status_update', status: 'second' }]);
        expect(push).toHaveBeenLastCalledWith([{ type: 'status_update', status: 'second' }], 1);

        let settled = false;
        const wait = pusher.waitAll().then(() => {
            settled = true;
        });

        await Promise.resolve();
        expect(settled).toBe(false);

        releaseSecond();
        await wait;
        expect(settled).toBe(true);
    });

    it('coalesces pushes while a DO push is in flight', async () => {
        let releaseFirst!: () => void;
        const first = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const push = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
        const pusher = createPusher({ push } as any, 'test');

        pusher.push([{ type: 'status_update', status: 'first' }]);
        pusher.push([{ type: 'status_update', status: 'second' }]);
        pusher.push([{ type: 'status_update', status: 'third' }]);

        expect(push).toHaveBeenCalledTimes(1);
        expect(push).toHaveBeenNthCalledWith(1, [{ type: 'status_update', status: 'first' }], 0);

        releaseFirst();
        await pusher.waitAll();

        expect(push).toHaveBeenCalledTimes(2);
        expect(push).toHaveBeenNthCalledWith(
            2,
            [
                { type: 'status_update', status: 'second' },
                { type: 'status_update', status: 'third' },
            ],
            1,
        );
    });
});
