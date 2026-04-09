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

function toolBlock(toolName: string): ToolCallStreamBlock {
	return {
		id: 'block_1',
		type: 'tool_call',
		toolName,
		toolCallId: 'tc_1',
		content: 'raw content',
		toolInput: { content: 'document body' },
		toolOutput: 'Written successfully',
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
	it('redacts write_document blocks in toJSON output', () => {
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

	it('handles messages without blocks', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = createMessage(em, { blocks: undefined });

		const json = msg.toJSON();
		// blocks should be null/undefined from toObject, not crash
		expect(json.blocks).toBeFalsy();
	});
});
