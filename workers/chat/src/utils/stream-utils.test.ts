import { describe, expect, it, vi } from 'vitest';
import { INTERLEAVE_ARTIFACT_IMAGE_CONTENT_PARTS } from '@/lib/markdown/artifact-images';

vi.mock('@/lib/artifacts/artifact-images', () => ({
	signArtifactImageKeys: vi.fn(async (_env: unknown, keys: string[]) => {
		const map = new Map<string, string>();
		for (const key of keys) {
			map.set(key, `https://signed.example/${key}`);
		}
		return map;
	}),
}));

vi.mock('../image-uploader', () => ({
	generateSignedImageUrls: vi.fn(async () => new Map()),
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
					text:
						'# Report\n\n![Chart](artifact-image://uploads/project/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/images/chart.png)',
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
});
