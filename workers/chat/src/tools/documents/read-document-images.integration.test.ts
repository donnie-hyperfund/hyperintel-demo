/**
 * Integration test: read_document image resolution.
 *
 * Verifies that read_document correctly resolves artifact-image:// refs
 * into multimodal content (stripped markdown + signed image URLs + imageRefs).
 *
 * Uses real DB, mocked R2 signing.
 *
 * Run with: pnpm vitest run --config workers/chat/vitest.config.ts read-document-images.integration
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { clearDatabase, closeTestOrm, getTestEm } from '@/tests/helpers/db';
import type { EntityManager } from '@mikro-orm/postgresql';
import { INTERLEAVE_ARTIFACT_IMAGE_CONTENT_PARTS } from '@/lib/markdown/artifact-images';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { createDocumentTools, type DocumentToolsContext } from './index';
import { DraftManager } from './draft-manager';
import { upsertDocument, type DocumentScope } from './document-service';
import type { Ctx } from '../../context';

// ============================================================================
// MOCK R2 SIGNING
// ============================================================================

vi.mock('@/lib/artifacts/artifact-images', () => ({
	signArtifactImageKeys: vi.fn(async (_env: unknown, keys: string[]) => {
		const map = new Map<string, string>();
		for (const key of keys) {
			map.set(key, `https://r2-signed.test/${key}?token=fake`);
		}
		return map;
	}),
}));

// ============================================================================
// HELPERS
// ============================================================================

const HAS_DB = !!process.env.DATABASE_URL;

/** Markdown with two artifact-image:// refs embedded. */
const MD_WITH_IMAGES = [
	'# Report',
	'',
	'Here is the introduction text.',
	'',
	'## Figures',
	'',
	'Figure 1 shows the architecture overview.',
	'',
	'![Architecture diagram](artifact-image://uploads/project/p1/ver-001/images/arch.png)',
	'',
	'Figure 2 shows the data flow.',
	'',
	'![Data flow](artifact-image://uploads/project/p1/ver-001/images/flow.jpg)',
	'',
	'## Conclusion',
	'',
	'That wraps up the report.',
].join('\n');

/** Markdown with no image refs. */
const MD_NO_IMAGES = [
	'# Plain Report',
	'',
	'Just text, no images here.',
	'',
	'## Section A',
	'',
	'Some content.',
].join('\n');

function getReadDocumentExecutor() {
	const tools = createDocumentTools();
	const readTool = tools.find((t) => t.name === 'read_document')!;
	return readTool.executor as (
		input: { name: string; version: 'approved' | 'proposed' | 'latest'; startLine?: number | null; endLine?: number | null },
		ctx: DocumentToolsContext,
		rCtx?: Ctx,
	) => Promise<any>;
}

// ============================================================================
// TESTS
// ============================================================================

describe.skipIf(!HAS_DB)('read_document image resolution', () => {
	let em: EntityManager;
	let projectId: string;
	let chatId: string;
	let scope: DocumentScope;
	let draftManager: DraftManager;

	const fakeEnv = {
		ENV: 'test',
		CF_ACCOUNT_ID: { get: async () => 'fake-account' },
		R2_ACCESS_KEY_ID: { get: async () => 'fake-key' },
		R2_SECRET_ACCESS_KEY: { get: async () => 'fake-secret' },
	};

	const fakeCtx = { env: fakeEnv } as unknown as Ctx;

	beforeAll(async () => {
		em = await getTestEm();
	});

	beforeEach(async () => {
		await clearDatabase();
		draftManager = new DraftManager();

		// Seed user → project → chat
		const freshEm = em.fork();
		const user = freshEm.create(UserEntity, { email: 'img-test@test.com', emailConfirmed: true, clerkId: 'img-test-user' });
		const project = freshEm.create(ProjectEntity, { name: 'Image Test Project', user });
		const chat = freshEm.create(ChatEntity, { phase: 'discovery', phase_index: 0, project });
		await freshEm.persistAndFlush([user, project, chat]);

		projectId = project.id;
		chatId = chat.id;
		scope = { projectId };
	});

	afterAll(async () => {
		await clearDatabase();
		await closeTestOrm();
	});

	function makeDocCtx(emFork?: EntityManager): DocumentToolsContext {
		return {
			em: emFork ?? em.fork(),
			projectId,
			chatId,
			draftManager,
			createdVersionIds: [],
		};
	}

	async function seedDocument(name: string, content: string) {
		const seedEm = em.fork();
		return upsertDocument(seedEm, scope, chatId, name, name, content, false, 'Other');
	}

	// ------------------------------------------------------------------
	// No images — existing behavior unchanged
	// ------------------------------------------------------------------

	it('returns plain response when no artifact-image:// refs exist', async () => {
		await seedDocument('plain-report.md', MD_NO_IMAGES);

		const executor = getReadDocumentExecutor();
		const result = await executor(
			{ name: 'plain-report.md', version: 'latest' },
			makeDocCtx(),
			fakeCtx,
		);

		// Should be a plain response (no wrapped result shape)
		expect(result.content).toContain('Just text, no images here.');
		expect(result.source).toBeDefined();
		expect(result).not.toHaveProperty('imageRefs');
		expect(result).not.toHaveProperty('contentParts');
	});

	// ------------------------------------------------------------------
	// With images — multimodal wrapped result
	// ------------------------------------------------------------------

	it('returns wrapped result with imageRefs and contentParts when images present', async () => {
		await seedDocument('img-report.md', MD_WITH_IMAGES);

		const executor = getReadDocumentExecutor();
		const result = await executor(
			{ name: 'img-report.md', version: 'latest' },
			makeDocCtx(),
			fakeCtx,
		);

		// Should be a wrapped result
		expect(result).toHaveProperty('result');
		expect(result).toHaveProperty('imageRefs');
		expect(result).toHaveProperty('contentParts');

		// imageRefs: full artifact-image:// URIs in order
		expect(result.imageRefs).toEqual([
			'artifact-image://uploads/project/p1/ver-001/images/arch.png',
			'artifact-image://uploads/project/p1/ver-001/images/flow.jpg',
		]);

		// result.content keeps artifact-image:// refs (stable for DB + CC replacement)
		const content = result.result.content as string;
		expect(content).toContain('artifact-image://uploads/project/p1/ver-001/images/arch.png');
		expect(content).toContain('artifact-image://uploads/project/p1/ver-001/images/flow.jpg');
		expect(content).toContain('Figure 1 shows the architecture overview.');
		expect(content).toContain('Figure 2 shows the data flow.');
		expect(content).toContain('# Report');

		if (INTERLEAVE_ARTIFACT_IMAGE_CONTENT_PARTS) {
			expect(result.contentParts).toHaveLength(5);
			expect(result.contentParts[0]).toMatchObject({ type: 'text' });
			expect(result.contentParts[0].text).toContain('# Report');
			expect(result.contentParts[0].text).toContain('Figure 1 shows the architecture overview.');
			expect(result.contentParts[1]).toMatchObject({
				type: 'image',
				source: 'url',
				mediaType: 'image/png',
			});
			expect(result.contentParts[1].url).toContain('arch.png');
			expect(result.contentParts[2]).toMatchObject({ type: 'text' });
			expect(result.contentParts[2].text).toContain('Figure 2 shows the data flow.');
			expect(result.contentParts[3]).toMatchObject({
				type: 'image',
				source: 'url',
				mediaType: 'image/jpeg',
			});
			expect(result.contentParts[3].url).toContain('flow.jpg');
			expect(result.contentParts[4]).toMatchObject({ type: 'text' });
			expect(result.contentParts[4].text).toContain('## Conclusion');
			expect(result.contentParts[4].text).toContain('That wraps up the report.');
		} else {
			expect(result.contentParts).toHaveLength(3);
			expect(result.contentParts[0]).toEqual({ type: 'text', text: content });
			expect(result.contentParts[1]).toMatchObject({
				type: 'image',
				source: 'url',
				mediaType: 'image/png',
			});
			expect(result.contentParts[1].url).toContain('arch.png');
			expect(result.contentParts[2]).toMatchObject({
				type: 'image',
				source: 'url',
				mediaType: 'image/jpeg',
			});
			expect(result.contentParts[2].url).toContain('flow.jpg');
		}
	});

	// ------------------------------------------------------------------
	// Draft path — no image resolution
	// ------------------------------------------------------------------

	it('returns plain draft content without image resolution', async () => {
		await seedDocument('draft-doc.md', MD_WITH_IMAGES);

		const dm = new DraftManager();
		dm.begin('test-scope', 'draft-doc.md', 'Draft Doc', 'edit', MD_WITH_IMAGES, 1, false, 'Other');

		const executor = getReadDocumentExecutor();
		const result = await executor(
			{ name: 'draft-doc.md', version: 'latest' },
			makeDocCtx(em.fork()),
			fakeCtx,
		);

		// Draft manager is separate per-context, so this won't match the draft.
		// Instead, seed a ctx that has the draft active:
		const ctxWithDraft = makeDocCtx();
		ctxWithDraft.draftManager = dm;

		const draftResult = await executor(
			{ name: 'draft-doc.md', version: 'latest' },
			ctxWithDraft,
			fakeCtx,
		);

		expect(draftResult.source).toBe('editing_draft');
		// Should contain raw artifact-image:// refs — no resolution
		expect(draftResult.content).toContain('artifact-image://');
		expect(draftResult).not.toHaveProperty('imageRefs');
		expect(draftResult).not.toHaveProperty('contentParts');
	});

	// ------------------------------------------------------------------
	// No rCtx — graceful fallback (no signing possible)
	// ------------------------------------------------------------------

	it('returns plain response when rCtx is not provided', async () => {
		await seedDocument('no-ctx-report.md', MD_WITH_IMAGES);

		const executor = getReadDocumentExecutor();
		const result = await executor(
			{ name: 'no-ctx-report.md', version: 'latest' },
			makeDocCtx(),
			// no rCtx
		);

		// Without rCtx, can't sign — falls through to plain response
		expect(result.content).toContain('artifact-image://');
		expect(result).not.toHaveProperty('imageRefs');
		expect(result).not.toHaveProperty('contentParts');
	});

	// ------------------------------------------------------------------
	// mediaType inference
	// ------------------------------------------------------------------

	it('infers correct mediaType from key extensions', async () => {
		const mdWebp = [
			'# WebP Test',
			'',
			'![Photo](artifact-image://uploads/project/p1/ver-001/images/photo.webp)',
		].join('\n');

		await seedDocument('webp-doc.md', mdWebp);

		const executor = getReadDocumentExecutor();
		const result = await executor(
			{ name: 'webp-doc.md', version: 'latest' },
			makeDocCtx(),
			fakeCtx,
		);

		const imagePart = result.contentParts.find((part: any) => part.type === 'image');
		expect(imagePart).toMatchObject({
			type: 'image',
			source: 'url',
			mediaType: 'image/webp',
		});
	});
});
