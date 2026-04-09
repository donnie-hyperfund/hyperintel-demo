import { describe, expect, it, vi } from 'vitest';
import {
	extractArtifactImageRefs,
	persistMarkdownImages,
	resolveArtifactImages,
	stripArtifactImages,
} from './artifact-images';

// ---------------------------------------------------------------------------
// extractArtifactImageRefs
// ---------------------------------------------------------------------------

describe('extractArtifactImageRefs', () => {
	it('extracts refs from artifact-image:// URLs', () => {
		const md = `
# Report

Some text.

![Chart A](artifact-image://uploads/org/v1/images/abc.png)

More text.

![Chart B](artifact-image://uploads/org/v1/images/def.jpg)
`;
		const refs = extractArtifactImageRefs(md);
		expect(refs).toEqual([
			{ alt: 'Chart A', key: 'uploads/org/v1/images/abc.png' },
			{ alt: 'Chart B', key: 'uploads/org/v1/images/def.jpg' },
		]);
	});

	it('returns empty array when no artifact images', () => {
		const md = '# Hello\n\n![normal](https://example.com/img.png)\n';
		expect(extractArtifactImageRefs(md)).toEqual([]);
	});

	it('ignores artifact-image:// inside code blocks', () => {
		const md = `
Some text.

\`\`\`
![not real](artifact-image://uploads/fake/key.png)
\`\`\`

\`![inline code](artifact-image://uploads/also/fake.png)\`
`;
		expect(extractArtifactImageRefs(md)).toEqual([]);
	});

	it('handles images with empty alt text', () => {
		const md = '![](artifact-image://uploads/org/v1/images/noalt.png)\n';
		const refs = extractArtifactImageRefs(md);
		expect(refs).toEqual([{ alt: '', key: 'uploads/org/v1/images/noalt.png' }]);
	});
});

// ---------------------------------------------------------------------------
// resolveArtifactImages
// ---------------------------------------------------------------------------

describe('resolveArtifactImages', () => {
	it('replaces artifact-image:// URLs with signed URLs', () => {
		const md = `# Report

![Chart](artifact-image://uploads/org/v1/images/abc.png)

Some text.
`;
		const signedUrls = new Map([
			['uploads/org/v1/images/abc.png', 'https://r2.example.com/signed/abc?token=xyz'],
		]);
		const result = resolveArtifactImages(md, signedUrls);
		expect(result).toContain('![Chart](https://r2.example.com/signed/abc?token=xyz)');
		expect(result).not.toContain('artifact-image://');
	});

	it('skips images whose key is not in the map', () => {
		const md = '![A](artifact-image://key1)\n![B](artifact-image://key2)\n';
		const signedUrls = new Map([['key1', 'https://signed/1']]);
		const result = resolveArtifactImages(md, signedUrls);
		expect(result).toContain('![A](https://signed/1)');
		expect(result).toContain('![B](artifact-image://key2)');
	});

	it('preserves surrounding markdown formatting', () => {
		const md = `| Column A | Column B |
|----------|----------|
| data     | ![img](artifact-image://k.png) |

> **Bold** text *italic*
`;
		const signedUrls = new Map([['k.png', 'https://signed/k']]);
		const result = resolveArtifactImages(md, signedUrls);
		expect(result).toContain('| data     | ![img](https://signed/k) |');
		expect(result).toContain('> **Bold** text *italic*');
	});
});

// ---------------------------------------------------------------------------
// stripArtifactImages
// ---------------------------------------------------------------------------

describe('stripArtifactImages', () => {
	it('removes standalone artifact image lines', () => {
		const md = `# Report

Some text.

![Chart](artifact-image://uploads/org/v1/images/abc.png)

More text.
`;
		const result = stripArtifactImages(md);
		expect(result).not.toContain('artifact-image://');
		expect(result).toContain('Some text.');
		expect(result).toContain('More text.');
	});

	it('removes inline artifact images', () => {
		const md = 'Before ![img](artifact-image://k.png) after\n';
		const result = stripArtifactImages(md);
		expect(result).toContain('Before');
		expect(result).toContain('after');
		expect(result).not.toContain('artifact-image://');
	});

	it('preserves non-artifact images', () => {
		const md = `![keep](https://example.com/photo.jpg)

![remove](artifact-image://key.png)
`;
		const result = stripArtifactImages(md);
		expect(result).toContain('![keep](https://example.com/photo.jpg)');
		expect(result).not.toContain('artifact-image://');
	});

	it('handles multiple artifact images', () => {
		const md = `Text A

![a](artifact-image://a.png)

Text B

![b](artifact-image://b.png)

Text C
`;
		const result = stripArtifactImages(md);
		expect(result).not.toContain('artifact-image://');
		expect(result).toContain('Text A');
		expect(result).toContain('Text B');
		expect(result).toContain('Text C');
	});

	it('does not leave excessive blank lines', () => {
		const md = `Line 1

![img](artifact-image://key.png)

Line 2
`;
		const result = stripArtifactImages(md);
		// Should not have more than 2 consecutive newlines (one blank line)
		expect(result).not.toMatch(/\n{4,}/);
	});
});

// ---------------------------------------------------------------------------
// persistMarkdownImages
// ---------------------------------------------------------------------------

describe('persistMarkdownImages', () => {
	// Tiny 1x1 red PNG as base64
	const RED_PIXEL_B64 =
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
	const DATA_URI = `data:image/png;base64,${RED_PIXEL_B64}`;

	it('replaces data: URIs with artifact-image:// refs', async () => {
		const md = `# Doc

![figure](${DATA_URI})

End.
`;
		const uploadFn = vi.fn().mockResolvedValue('uploads/org/v1/images/uuid.png');
		const result = await persistMarkdownImages(md, uploadFn);

		expect(result).toContain('![figure](artifact-image://uploads/org/v1/images/uuid.png)');
		expect(result).not.toContain('data:image');
		expect(uploadFn).toHaveBeenCalledOnce();

		// Verify the upload received correct content type and non-empty bytes
		const [bytes, contentType] = uploadFn.mock.calls[0];
		expect(contentType).toBe('image/png');
		expect(bytes.byteLength).toBeGreaterThan(0);
	});

	it('handles multiple data URIs in parallel', async () => {
		const md = `![a](${DATA_URI})\n\n![b](${DATA_URI})\n`;
		let counter = 0;
		const uploadFn = vi.fn().mockImplementation(async () => {
			return `uploads/img-${++counter}.png`;
		});
		const result = await persistMarkdownImages(md, uploadFn);

		expect(uploadFn).toHaveBeenCalledTimes(2);
		expect(result).toContain('artifact-image://');
		expect(result).not.toContain('data:image');
	});

	it('returns markdown unchanged when no data URIs', async () => {
		const md = '# Hello\n\n![normal](https://example.com/img.png)\n';
		const uploadFn = vi.fn();
		const result = await persistMarkdownImages(md, uploadFn);

		expect(result).toBe(md);
		expect(uploadFn).not.toHaveBeenCalled();
	});

	it('ignores data URIs inside code blocks', async () => {
		const md = `\`\`\`\n![code](data:image/png;base64,abc)\n\`\`\`\n`;
		const uploadFn = vi.fn();
		const result = await persistMarkdownImages(md, uploadFn);

		expect(uploadFn).not.toHaveBeenCalled();
		expect(result).toBe(md);
	});
});
