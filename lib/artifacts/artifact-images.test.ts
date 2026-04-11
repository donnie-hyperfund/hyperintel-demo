import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/vendor/r2', () => ({
	createWorkerS3Client: vi.fn(async () => ({ stub: true })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: vi.fn(async (_client: unknown, command: { input: { Key: string } }) => {
		return `https://signed.example/${command.input.Key}`;
	}),
}));

import { hydrateArtifactImages } from './artifact-images';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

describe('hydrateArtifactImages', () => {
	const env = {
		ENV: 'test',
		CF_ACCOUNT_ID: { get: async () => 'fake-account' },
		R2_ACCESS_KEY_ID: { get: async () => 'fake-key' },
		R2_SECRET_ACCESS_KEY: { get: async () => 'fake-secret' },
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('only signs image keys inside the active project scope', async () => {
		const markdown = [
			'# Images',
			'',
			'![Allowed](artifact-image://uploads/project/project-1/artifact-1/images/chart.png)',
			'',
			'![Wrong Path](artifact-image://uploads/project/project-1/artifact-1/chart.png)',
			'',
			'![Wrong Scope](artifact-image://uploads/project/project-2/artifact-2/images/other.png)',
			'',
			'![Wrong Type](artifact-image://uploads/chat/chat-1/artifact-3/images/chat.png)',
		].join('\n');

		const hydrated = await hydrateArtifactImages(markdown, env, { projectId: 'project-1' });

		expect(hydrated).not.toBeNull();
		expect(hydrated?.imageRefs).toEqual([
			'artifact-image://uploads/project/project-1/artifact-1/images/chart.png',
		]);
		expect(vi.mocked(getSignedUrl)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(getSignedUrl).mock.calls[0]?.[1]).toMatchObject({
			input: { Key: 'uploads/project/project-1/artifact-1/images/chart.png' },
		});
		expect(hydrated?.contentParts.some((part) => part.type === 'image')).toBe(true);
	});

	it('returns null when no signable image refs remain after filtering', async () => {
		const markdown = '![Wrong Path](artifact-image://uploads/project/project-1/artifact-1/chart.png)';

		const hydrated = await hydrateArtifactImages(markdown, env, { projectId: 'project-1' });

		expect(hydrated).toBeNull();
		expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled();
	});
});
