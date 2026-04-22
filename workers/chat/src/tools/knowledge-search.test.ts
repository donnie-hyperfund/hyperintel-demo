import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@common/ai/embeddings', () => ({
	embedTexts: vi.fn(async () => [[0.1, 0.2, 0.3]]),
}));

vi.mock('@/lib/artifacts/artifact-images', () => ({
	hydrateArtifactImages: vi.fn(async (text: string) => ({
		text,
		imageRefs: ['artifact-image://uploads/project/project-1/artifact-1/images/chart.png'],
		contentParts: [
			{ type: 'text', text: 'text before' },
			{
				type: 'image',
				source: 'url',
				url: 'https://signed.example/uploads/project/project-1/artifact-1/images/chart.png',
				mediaType: 'image/png',
			},
		],
	})),
}));

import { hydrateArtifactImages } from '@/lib/artifacts/artifact-images';
import { createKnowledgeTools } from './knowledge-search';

describe('search_knowledge image handling', () => {
	const execute = vi.fn();
	const em = {
		getConnection: () => ({ execute }),
	};
	const eCtx = {
		openai: {} as any,
		env: {
			ENV: 'test',
			CF_ACCOUNT_ID: { get: async () => 'fake-account' },
			R2_ACCESS_KEY_ID: { get: async () => 'fake-key' },
			R2_SECRET_ACCESS_KEY: { get: async () => 'fake-secret' },
		},
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
		execute.mockResolvedValue([
			{
				chunk_content:
					'Figure summary.\n\n![Chart](artifact-image://uploads/project/project-1/artifact-1/images/chart.png)',
				chunk_index: 0,
				artifact_id: 'artifact-1',
				title: 'Report',
				key: 'report.md',
				similarity: 0.91,
			},
		]);
	});

	it('hydrates embedded images when includeImages is true', async () => {
		const tool = createKnowledgeTools().find((candidate) => candidate.name === 'search_knowledge');
		const result = await tool!.executor(
			{ query: 'figure summary', includeImages: true },
			{ em: em as any, projectId: 'project-1' },
			eCtx,
		);

		expect(hydrateArtifactImages).toHaveBeenCalledOnce();
		expect(vi.mocked(hydrateArtifactImages).mock.calls[0]?.[2]).toEqual({ projectId: 'project-1', chatId: undefined });
		expect(result).toMatchObject({
			imageRefs: ['artifact-image://uploads/project/project-1/artifact-1/images/chart.png'],
		});
	});

	it('returns a note instead of hydrating when includeImages is false', async () => {
		const tool = createKnowledgeTools().find((candidate) => candidate.name === 'search_knowledge');
		const result = await tool!.executor(
			{ query: 'figure summary', includeImages: false },
			{ em: em as any, projectId: 'project-1' },
			eCtx,
		);

		expect(hydrateArtifactImages).not.toHaveBeenCalled();
		expect(result).toContain('> Note: Some results contain embedded images.');
		expect(result).toContain('artifact-image://uploads/project/project-1/artifact-1/images/chart.png');
	});
});
