import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/artifacts/artifact-images', () => ({
	uploadArtifactImage: vi.fn(),
}));

import { uploadArtifactImage } from '@/lib/artifacts/artifact-images';
import { processChunksWithImages } from './index';

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
