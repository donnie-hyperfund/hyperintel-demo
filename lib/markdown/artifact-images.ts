/**
 * Server-side remark utilities for artifact image handling.
 *
 * Uses AST parsing (not regex) to correctly identify image nodes —
 * avoids false-matching inside code blocks, inline code, or prose.
 *
 * All modification functions operate on string positions derived from the AST
 * rather than using remark-stringify, to avoid formatting normalization.
 */

import type { Image, Root } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

const ARTIFACT_IMAGE_SCHEME = 'artifact-image://';

function parseMarkdown(markdown: string): Root {
	return unified().use(remarkParse).parse(markdown);
}

/** Collect image nodes matching a predicate, sorted by position descending (for safe back-to-front splicing). */
function collectImageNodes(tree: Root, predicate: (node: Image) => boolean): Image[] {
	const nodes: Image[] = [];
	visit(tree, 'image', (node: Image) => {
		if (predicate(node) && node.position) {
			nodes.push(node);
		}
	});
	return nodes.sort((a, b) => b.position!.start.offset! - a.position!.start.offset!);
}

// ---------------------------------------------------------------------------
// 1. Extract refs
// ---------------------------------------------------------------------------

export interface ArtifactImageRef {
	alt: string;
	/** R2 storage key — everything after `artifact-image://` */
	key: string;
}

/**
 * Parse markdown, visit image nodes, return refs whose `url` starts with `artifact-image://`.
 */
export function extractArtifactImageRefs(markdown: string): ArtifactImageRef[] {
	const tree = parseMarkdown(markdown);
	const refs: ArtifactImageRef[] = [];
	visit(tree, 'image', (node: Image) => {
		if (node.url.startsWith(ARTIFACT_IMAGE_SCHEME)) {
			refs.push({
				alt: node.alt || '',
				key: node.url.slice(ARTIFACT_IMAGE_SCHEME.length),
			});
		}
	});
	return refs;
}

// ---------------------------------------------------------------------------
// 2. Resolve URLs
// ---------------------------------------------------------------------------

/**
 * Replace `artifact-image://` URLs with corresponding signed URLs from the map.
 * Operates on string positions — original formatting is preserved.
 */
export function resolveArtifactImages(markdown: string, signedUrls: Map<string, string>): string {
	const tree = parseMarkdown(markdown);
	const nodes = collectImageNodes(tree, (n) => n.url.startsWith(ARTIFACT_IMAGE_SCHEME));

	let result = markdown;
	for (const node of nodes) {
		const key = node.url.slice(ARTIFACT_IMAGE_SCHEME.length);
		const signedUrl = signedUrls.get(key);
		if (!signedUrl) continue;

		const start = node.position!.start.offset!;
		const end = node.position!.end.offset!;
		const raw = result.slice(start, end);
		result = result.slice(0, start) + raw.replace(node.url, signedUrl) + result.slice(end);
	}
	return result;
}

// ---------------------------------------------------------------------------
// 3. Strip images
// ---------------------------------------------------------------------------

/**
 * Remove image nodes with `artifact-image://` URLs from the markdown.
 * If the image is alone on its line, the entire line (including its newline) is removed.
 */
export function stripArtifactImages(markdown: string): string {
	const tree = parseMarkdown(markdown);
	const nodes = collectImageNodes(tree, (n) => n.url.startsWith(ARTIFACT_IMAGE_SCHEME));

	let result = markdown;
	for (const node of nodes) {
		let start = node.position!.start.offset!;
		let end = node.position!.end.offset!;

		// Find line boundaries around this node
		let lineStart = start;
		while (lineStart > 0 && result[lineStart - 1] !== '\n') lineStart--;
		let lineEnd = end;
		while (lineEnd < result.length && result[lineEnd] !== '\n') lineEnd++;

		// If the image is the only non-whitespace content on its line, remove the entire line
		const before = result.slice(lineStart, start).trim();
		const after = result.slice(end, lineEnd).trim();
		if (!before && !after) {
			start = lineStart;
			end = lineEnd < result.length ? lineEnd + 1 : lineEnd; // consume trailing \n
		}

		result = result.slice(0, start) + result.slice(end);
	}
	return result;
}

// ---------------------------------------------------------------------------
// 4. Persist embedded images
// ---------------------------------------------------------------------------

/**
 * Find image nodes with `data:` URIs, upload each via `uploadFn`, and replace
 * the data URI with `artifact-image://{storageKey}`.
 */
export async function persistMarkdownImages(
	markdown: string,
	uploadFn: (bytes: ArrayBuffer, contentType: string) => Promise<string>,
): Promise<string> {
	const tree = parseMarkdown(markdown);
	const nodes = collectImageNodes(tree, (n) => n.url.startsWith('data:'));
	if (nodes.length === 0) return markdown;

	// Upload all images in parallel, preserving the descending-position order
	const uploads = await Promise.all(
		nodes.map(async (node) => {
			const { bytes, contentType } = parseDataUri(node.url);
			const storageKey = await uploadFn(bytes, contentType);
			return { node, storageKey };
		}),
	);

	let result = markdown;
	for (const { node, storageKey } of uploads) {
		const start = node.position!.start.offset!;
		const end = node.position!.end.offset!;
		const raw = result.slice(start, end);
		result =
			result.slice(0, start) +
			raw.replace(node.url, `${ARTIFACT_IMAGE_SCHEME}${storageKey}`) +
			result.slice(end);
	}
	return result;
}

// ---------------------------------------------------------------------------
// 5. Split at images (interleaved segments)
// ---------------------------------------------------------------------------

export type MarkdownSegment =
	| { type: 'text'; text: string }
	| { type: 'image'; key: string; alt: string };

/**
 * Split markdown at `artifact-image://` nodes, returning interleaved text/image segments.
 * Preserves document order — useful for building interleaved multimodal content parts.
 *
 * When an image is alone on its line, the entire line (including newline) is consumed
 * so adjacent text segments don't contain empty placeholder lines.
 */
export function splitAtArtifactImages(markdown: string): MarkdownSegment[] {
	const tree = parseMarkdown(markdown);
	const nodes: Image[] = [];
	visit(tree, 'image', (node: Image) => {
		if (node.url.startsWith(ARTIFACT_IMAGE_SCHEME) && node.position) {
			nodes.push(node);
		}
	});
	// Ascending position (document order)
	nodes.sort((a, b) => a.position!.start.offset! - b.position!.start.offset!);

	if (nodes.length === 0) return [{ type: 'text', text: markdown }];

	const segments: MarkdownSegment[] = [];
	let cursor = 0;

	for (const node of nodes) {
		let start = node.position!.start.offset!;
		let end = node.position!.end.offset!;

		// If image is alone on its line, consume the full line
		let lineStart = start;
		while (lineStart > 0 && markdown[lineStart - 1] !== '\n') lineStart--;
		let lineEnd = end;
		while (lineEnd < markdown.length && markdown[lineEnd] !== '\n') lineEnd++;

		const before = markdown.slice(lineStart, start).trim();
		const after = markdown.slice(end, lineEnd).trim();
		if (!before && !after) {
			start = lineStart;
			end = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
		}

		const textBefore = markdown.slice(cursor, start);
		if (textBefore) {
			segments.push({ type: 'text', text: textBefore });
		}

		segments.push({
			type: 'image',
			key: node.url.slice(ARTIFACT_IMAGE_SCHEME.length),
			alt: node.alt || '',
		});

		cursor = end;
	}

	const remaining = markdown.slice(cursor);
	if (remaining) {
		segments.push({ type: 'text', text: remaining });
	}

	return segments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDataUri(uri: string): { bytes: ArrayBuffer; contentType: string } {
	const match = uri.match(/^data:([^;]+);base64,(.+)$/s);
	if (!match) throw new Error(`Invalid data URI: ${uri.slice(0, 80)}...`);
	const contentType = match[1];
	const base64 = match[2];
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return { bytes: bytes.buffer as ArrayBuffer, contentType };
}
