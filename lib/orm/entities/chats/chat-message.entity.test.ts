/**
 * Tests that ChatMessageEntity.toJSON() correctly:
 * - Hides debug_data (via @Property({ hidden: true }))
 * - Strips dev-only metadata fields (preset, inference, usage) when dev group is inactive
 * - Keeps metadata fields when dev group is active
 * - Still redacts document tool blocks (integration with block redaction)
 */

import { wrap } from '@mikro-orm/core';
import { MikroORM, defineConfig } from '@mikro-orm/postgresql';
import type { ToolCallStreamBlock, TextStreamBlock, StreamBlock } from '@/common/ai/agent/types';
import { ScopedEntityManager } from '@/common/orm/entity-manager';
import { setDeploymentGroups, patchToObjectGroups } from '@/common/orm/serialization';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';

let orm: MikroORM;

beforeAll(async () => {
	orm = await MikroORM.init(
		defineConfig({
			clientUrl: 'postgresql://fake:fake@localhost:5432/fake',
			connect: false,
			entityManager: ScopedEntityManager as any,
			entities: [ArtifactVersionEntity, ArtifactEntity, ChatMessageEntity, ChatEntity, ProjectEntity, UserEntity],
		}),
	);
	patchToObjectGroups();
});

afterAll(async () => {
	await orm?.close(true);
});

function createMessage(em: ScopedEntityManager, overrides: Partial<{
	metadata: Record<string, unknown>;
	debug_data: Record<string, unknown>;
	blocks: StreamBlock[];
}> = {}): ChatMessageEntity {
	const entity = em.create(ChatMessageEntity, {
		id: '00000000-0000-0000-0000-000000000099',
		role: 'assistant',
		content: 'Hello world',
		chat: '00000000-0000-0000-0000-000000000001' as any,
		created_at: new Date('2026-01-01'),
		metadata: {
			preset: 'fast-research',
			inference: { provider: 'anthropic', model: 'claude-4' },
			usage: { prompt_tokens: 100, completion_tokens: 50 },
			visible_field: 'keep me',
		},
		...overrides,
	});
	em.getUnitOfWork().merge(entity);
	return entity;
}

// -- fixtures ----------------------------------------------------------------

function toolBlock(toolName: string, metadata?: Record<string, unknown>): ToolCallStreamBlock {
	return {
		id: 'block_1',
		type: 'tool_call',
		toolName,
		toolCallId: 'tc_1',
		content: 'raw content',
		toolInput: { content: 'document body' },
		toolOutput: 'Written successfully',
		...(metadata && { metadata }),
	};
}

function textBlock(text = 'Hello'): TextStreamBlock {
	return { id: 'block_t', type: 'text', content: text };
}

// -- tests -------------------------------------------------------------------

describe('ChatMessageEntity — debug_data hidden', () => {
	it('debug_data is excluded from toObject output', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			debug_data: { raw_response: 'lots of debug info' },
		});

		const obj = wrap(msg).toObject();
		expect(obj).not.toHaveProperty('debug_data');
	});

	it('debug_data is excluded from toJSON output', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			debug_data: { raw_response: 'lots of debug info' },
		});

		const json = msg.toJSON();
		expect(json).not.toHaveProperty('debug_data');
	});

	it('debug_data is still accessible on the entity instance', () => {
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			debug_data: { raw_response: 'lots of debug info' },
		});

		expect(msg.debug_data).toEqual({ raw_response: 'lots of debug info' });
	});
});

describe('ChatMessageEntity — metadata dev-only field stripping', () => {
	it('strips preset, inference, usage from metadata when dev group is inactive', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em);

		const json = msg.toJSON();
		const meta = json.metadata as Record<string, unknown>;
		expect(meta).not.toHaveProperty('preset');
		expect(meta).not.toHaveProperty('inference');
		expect(meta).not.toHaveProperty('usage');
		expect(meta).toHaveProperty('visible_field', 'keep me');
	});

	it('keeps all metadata fields when dev group is active (deployment-level)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em);

		const json = msg.toJSON();
		const meta = json.metadata as Record<string, unknown>;
		expect(meta).toHaveProperty('preset', 'fast-research');
		expect(meta).toHaveProperty('inference');
		expect(meta).toHaveProperty('usage');
		expect(meta).toHaveProperty('visible_field', 'keep me');
	});

	it('keeps all metadata fields when dev group is added at request level', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		em.addSerializationGroups('dev');
		const msg = createMessage(em);

		const json = msg.toJSON();
		const meta = json.metadata as Record<string, unknown>;
		expect(meta).toHaveProperty('preset');
		expect(meta).toHaveProperty('inference');
		expect(meta).toHaveProperty('usage');
	});

	it('strips dev fields when dev is excluded at request level', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		em.excludeSerializationGroups('dev');
		const msg = createMessage(em);

		const json = msg.toJSON();
		const meta = json.metadata as Record<string, unknown>;
		expect(meta).not.toHaveProperty('preset');
		expect(meta).not.toHaveProperty('inference');
		expect(meta).not.toHaveProperty('usage');
		expect(meta).toHaveProperty('visible_field', 'keep me');
	});

	it('sets metadata to null when all fields are dev-only and stripped', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			metadata: {
				preset: 'fast-research',
				inference: { provider: 'anthropic' },
				usage: { prompt_tokens: 100 },
			},
		});

		const json = msg.toJSON();
		expect(json.metadata).toBeNull();
	});

	it('handles null metadata gracefully', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, { metadata: undefined });

		const json = msg.toJSON();
		// Should not throw, metadata stays null/undefined
		expect(json.metadata).toBeFalsy();
	});
});

describe('ChatMessageEntity — block redaction in toJSON', () => {
	it('redacts write_document blocks when metadata is missing (legacy/fail-closed)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			blocks: [textBlock('visible'), toolBlock('write_document'), toolBlock('web_search')],
		});

		const json = msg.toJSON();
		const blocks = json.blocks as StreamBlock[];

		expect((blocks[0] as TextStreamBlock).content).toBe('visible');
		expect((blocks[1] as ToolCallStreamBlock).content).toBe('REDACTED');
		expect((blocks[1] as ToolCallStreamBlock).toolInput).toBe('REDACTED');
		expect((blocks[1] as ToolCallStreamBlock).toolOutput).toBe('REDACTED');
		expect((blocks[2] as ToolCallStreamBlock).content).toBe('raw content');
	});

	it('redacts write_document blocks when metadata.internal is true', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			blocks: [toolBlock('write_document', { internal: true })],
		});

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
		expect(block.content).toBe('REDACTED');
		expect(block.toolInput).toBe('REDACTED');
		expect(block.toolOutput).toBe('REDACTED');
	});

	it('preserves write_document blocks when metadata.internal is false (public doc)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			blocks: [toolBlock('write_document', { internal: false })],
		});

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
		expect(block.content).toBe('raw content');
		expect(block.toolInput).toEqual({ content: 'document body' });
		expect(block.toolOutput).toBe('Written successfully');
	});

	it('redacts patch_document blocks when metadata is missing (legacy/fail-closed)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			blocks: [toolBlock('patch_document')],
		});

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
		expect(block.content).toBe('REDACTED');
		expect(block.toolInput).toBe('REDACTED');
		expect(block.toolOutput).toBe('REDACTED');
	});

	it('preserves patch_document blocks when metadata.internal is false (public doc)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, {
			blocks: [toolBlock('patch_document', { internal: false })],
		});

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
		expect(block.content).toBe('raw content');
		expect(block.toolInput).toEqual({ content: 'document body' });
		expect(block.toolOutput).toBe('Written successfully');
	});

	it('redacts read_document output for internal/legacy reads but preserves input', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const readBlock: ToolCallStreamBlock = {
			id: 'block_r',
			type: 'tool_call',
			toolName: 'read_document',
			toolCallId: 'tc_r',
			content: 'INTERNAL DOC FULL TEXT',
			toolInput: { name: 'internal-strategy.md', startLine: 1, endLine: 50 },
			toolOutput: '1: Confidential\n2: details\n...',
		};
		const msg = createMessage(em, { blocks: [readBlock] });

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
		expect(block.content).toBe('REDACTED');
		expect(block.toolOutput).toBe('REDACTED');
		// Input preserved — just metadata, no leak.
		expect(block.toolInput).toEqual({ name: 'internal-strategy.md', startLine: 1, endLine: 50 });
	});

	it('preserves read_document blocks when metadata.internal is false (public read)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const readBlock: ToolCallStreamBlock = {
			id: 'block_r',
			type: 'tool_call',
			toolName: 'read_document',
			toolCallId: 'tc_r',
			content: 'PUBLIC DOC TEXT',
			toolInput: { name: 'public-faq.md', startLine: 1, endLine: 10 },
			toolOutput: '1: Public content\n2: more public\n...',
			metadata: { internal: false },
		};
		const msg = createMessage(em, { blocks: [readBlock] });

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
		expect(block.content).toBe('PUBLIC DOC TEXT');
		expect(block.toolOutput).toBe('1: Public content\n2: more public\n...');
		expect(block.toolInput).toEqual({ name: 'public-faq.md', startLine: 1, endLine: 10 });
	});

	it('wipes toolImageRefs/toolContentParts on internal read_document redaction', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const readBlock: ToolCallStreamBlock = {
			id: 'block_r',
			type: 'tool_call',
			toolName: 'read_document',
			toolCallId: 'tc_r',
			content: 'INTERNAL',
			toolInput: { name: 'internal.md' },
			toolOutput: 'INTERNAL OUTPUT',
			toolImageRefs: ['artifact-image://abc123'],
			toolContentParts: [{ type: 'text', text: 'leaked' }],
		};
		const msg = createMessage(em, { blocks: [readBlock] });

		const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock & {
			toolImageRefs?: string[];
			toolContentParts?: unknown[];
		};
		expect(block.content).toBe('REDACTED');
		expect(block.toolImageRefs).toBeUndefined();
		expect(block.toolContentParts).toBeUndefined();
	});

	it('does not redact non-document tool blocks (e.g. web_search)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, { blocks: [toolBlock('web_search')] });

		const json = msg.toJSON();
		const block = (json.blocks as StreamBlock[])[0] as ToolCallStreamBlock;

		expect(block.content).toBe('raw content');
		expect(block.toolOutput).toBe('Written successfully');
	});

	describe('REDACT_DOC_WRITE_TOOL_OUTPUT kill-switch', () => {
		// The flag defaults to true (defense-in-depth); these tests pass false explicitly via the
		// redactBlocks second arg to verify the flag-flipped behavior without module reload tricks.

		it('with flag=false, write_document content + toolOutput preserved (toolInput still redacted)', () => {
			setDeploymentGroups(orm, ['dev']);
			const em = orm.em.fork() as ScopedEntityManager;
			const msg = createMessage(em, {
				blocks: [toolBlock('write_document', { internal: true })],
			});

			const redacted = (msg as any).redactBlocks(msg.blocks, false) as StreamBlock[];
			const block = redacted[0] as ToolCallStreamBlock;

			expect(block.toolInput).toBe('REDACTED'); // input still redacted (carries content)
			expect(block.content).toBe('raw content'); // preserved (just stats today)
			expect(block.toolOutput).toBe('Written successfully'); // preserved (just stats today)
		});

		it('with flag=false, patch_document content + toolOutput preserved (toolInput still redacted)', () => {
			setDeploymentGroups(orm, ['dev']);
			const em = orm.em.fork() as ScopedEntityManager;
			const msg = createMessage(em, {
				blocks: [toolBlock('patch_document', { internal: true })],
			});

			const redacted = (msg as any).redactBlocks(msg.blocks, false) as StreamBlock[];
			const block = redacted[0] as ToolCallStreamBlock;

			expect(block.toolInput).toBe('REDACTED');
			expect(block.content).toBe('raw content');
			expect(block.toolOutput).toBe('Written successfully');
		});

		it('with flag=false, public-doc write_document still fully preserved', () => {
			setDeploymentGroups(orm, ['dev']);
			const em = orm.em.fork() as ScopedEntityManager;
			const msg = createMessage(em, {
				blocks: [toolBlock('write_document', { internal: false })],
			});

			const redacted = (msg as any).redactBlocks(msg.blocks, false) as StreamBlock[];
			const block = redacted[0] as ToolCallStreamBlock;

			// Public-doc preservation gate fires before the flag check; nothing redacted.
			expect(block.content).toBe('raw content');
			expect(block.toolInput).toEqual({ content: 'document body' });
			expect(block.toolOutput).toBe('Written successfully');
		});

		it('with flag=false, read_document still redacts internal output (flag is write/patch-only)', () => {
			setDeploymentGroups(orm, ['dev']);
			const em = orm.em.fork() as ScopedEntityManager;
			const readBlock: ToolCallStreamBlock = {
				id: 'block_r',
				type: 'tool_call',
				toolName: 'read_document',
				toolCallId: 'tc_r',
				content: 'INTERNAL',
				toolInput: { name: 'internal.md' },
				toolOutput: 'INTERNAL OUTPUT',
				metadata: { internal: true },
			};
			const msg = createMessage(em, { blocks: [readBlock] });

			const redacted = (msg as any).redactBlocks(msg.blocks, false) as StreamBlock[];
			const block = redacted[0] as ToolCallStreamBlock;

			// Flag does NOT govern read_document — internal reads still redact output.
			expect(block.content).toBe('REDACTED');
			expect(block.toolOutput).toBe('REDACTED');
		});

		it('default invocation (no second arg) honors module const (currently true)', () => {
			setDeploymentGroups(orm, ['dev']);
			const em = orm.em.fork() as ScopedEntityManager;
			const msg = createMessage(em, {
				blocks: [toolBlock('write_document', { internal: true })],
			});

			// toJSON() path uses the default — currently REDACT_DOC_WRITE_TOOL_OUTPUT=true.
			const block = (msg.toJSON().blocks as StreamBlock[])[0] as ToolCallStreamBlock;
			expect(block.content).toBe('REDACTED');
			expect(block.toolOutput).toBe('REDACTED');
		});
	});

	it('handles messages without blocks', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, { blocks: undefined });

		const json = msg.toJSON();
		// blocks should be null/undefined from toObject, not crash
		expect(json.blocks).toBeFalsy();
	});
});
