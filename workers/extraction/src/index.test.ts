import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
	frontendEnv: {
		NEXT_PUBLIC_LOCAL_WORKERS: true,
		NEXT_PUBLIC_CLOUDFLARE_BASE: '',
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
	},
}));

vi.mock('@/lib/api/requests/worker/common', () => ({
	getWorkerUrl: vi.fn(() => 'https://worker.example/mock'),
}));

vi.mock('@/lib/artifacts/artifact-images', () => ({
	uploadArtifactImage: vi.fn(),
}));

import { uploadArtifactImage } from '@/lib/artifacts/artifact-images';
import { processChunksWithImages, processMessage } from './index';

describe('processChunksWithImages', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(uploadArtifactImage).mockImplementation(async (_bucket, _prefix, _bytes, _contentType) => {
			return `uploads/project/p1/ver-001/images/${crypto.randomUUID()}.png`;
		});
	});

	it('attaches each uploaded image to the matching figure block when figure summaries repeat', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(
				new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					headers: { 'Content-Type': 'image/png' },
				}),
			)
			.mockResolvedValueOnce(
				new Response(new Uint8Array([4, 5, 6]), {
					status: 200,
					headers: { 'Content-Type': 'image/png' },
				}),
			);
		vi.stubGlobal('fetch', fetchMock);

		const chunks = [
			{
				content: ['Intro text', 'Figure summary', 'Between text', 'Figure summary', 'Closing text'].join('\n\n'),
				blocks: [
					{ type: 'Paragraph', content: 'Intro text' },
					{ type: 'Figure', content: 'Figure summary', image_url: 'https://example.com/a.png' },
					{ type: 'Paragraph', content: 'Between text' },
					{ type: 'Figure', content: 'Figure summary', image_url: 'https://example.com/b.png' },
					{ type: 'Paragraph', content: 'Closing text' },
				],
			},
		] as any;

		const { contents, imageCount } = await processChunksWithImages(chunks, {} as R2Bucket, 'uploads/project/p1/ver-001/images');

		expect(imageCount).toBe(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const content = contents[0];
		const imageRefs = [...content.matchAll(/artifact-image:\/\/([^)]+)/g)].map((match) => match[1]);

		expect(imageRefs).toHaveLength(2);
		expect(content).toMatch(
			/Intro text\s+Figure summary\s+!\[Figure summary\]\(artifact-image:\/\/[^)]+\)\s+Between text\s+Figure summary\s+!\[Figure summary\]\(artifact-image:\/\/[^)]+\)\s+Closing text/s,
		);
	});
});

describe('processMessage image uploads', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(uploadArtifactImage).mockImplementation(async (_bucket, _prefix, _bytes, _contentType) => {
			return `uploads/project/p1/artifact-1/images/${crypto.randomUUID()}.png`;
		});
	});

	it('stores a raw artifact-image ref when processing an uploaded image without Reducto', async () => {
		const bucketGet = vi.fn().mockResolvedValue({
			arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
		});

		const version = {
			id: 'version-1',
			content: '',
			status: 'proposed',
			status_changed_at: null,
			artifact: { current_version: null },
		};
		const file = {
			id: 'file-1',
			status: 'uploaded',
			extracted_content: null,
		};

		const em = {
			findOneOrFail: vi
				.fn()
				.mockResolvedValueOnce(version)
				.mockResolvedValueOnce(file),
			flush: vi.fn(),
		};

		const result = await processMessage(
			{
				type: 'extract_file_content',
				fileId: 'file-1',
				artifactId: 'artifact-1',
				versionId: 'version-1',
				storageKey: 'uploads/project/p1/version-1/original.png',
				originalName: 'original.png',
				mimeType: 'image/png',
				projectId: 'p1',
				chatId: null,
				previewAlias: null,
			},
			{
				env: {
					ARTIFACTS_BUCKET: { get: bucketGet } as unknown as R2Bucket,
				} as Env,
				em: em as any,
			},
			'[test]',
		);

		expect(result).toEqual({ success: true });
		expect(bucketGet).toHaveBeenCalledWith('uploads/project/p1/version-1/original.png');
		expect(uploadArtifactImage).toHaveBeenCalledTimes(1);
		expect(version.status).toBe('approved');
		expect(version.content).toContain('artifact-image://uploads/project/p1/artifact-1/images/');
		expect(file.status).toBe('processed');
		expect(file.extracted_content).toContain('artifact-image://uploads/project/p1/artifact-1/images/');
	});
});
