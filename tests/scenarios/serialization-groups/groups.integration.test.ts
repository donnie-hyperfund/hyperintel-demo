/**
 * Integration test: serialization groups with real database.
 *
 * Verifies that entities persisted and loaded from the DB respect
 * serialization group filtering end-to-end (not just in-memory creates).
 *
 * Requires DATABASE_URL — skipped otherwise.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { wrap } from '@mikro-orm/core';
import type { MikroORM } from '@mikro-orm/postgresql';
import { ScopedEntityManager } from '@/common/orm/entity-manager';
import { setDeploymentGroups, patchToObjectGroups, initSerializationGroups } from '@/common/orm/serialization';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getTestOrm, closeTestOrm } from '@/tests/helpers/db';

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)('Serialization groups — integration (real DB)', () => {
	let orm: MikroORM;
	let userId: string;
	let projectId: string;

	beforeAll(async () => {
		orm = await getTestOrm();
		initSerializationGroups(orm);

		const em = orm.em.fork() as ScopedEntityManager;
		const user = em.create(UserEntity, {
			email: 'test-serialization@example.com',
			emailConfirmed: true,
		});
		await em.flush();
		userId = user.id;

		const project = em.create(ProjectEntity, {
			name: 'Test Project',
			user: userId,
		});
		await em.flush();
		projectId = project.id;
	});

	afterAll(async () => {
		if (orm) {
			const em = orm.em.fork();
			await em.nativeDelete(ChatMessageEntity, {});
			await em.nativeDelete(ChatEntity, {});
			await em.nativeDelete(ProjectEntity, { id: projectId });
			await em.nativeDelete(UserEntity, { id: userId });
		}
		await closeTestOrm();
	});

	let chatId: string;

	beforeEach(async () => {
		// Create a chat with total_cost and a message with metadata + debug_data
		const em = orm.em.fork() as ScopedEntityManager;

		// Clean up previous test data
		await em.nativeDelete(ChatMessageEntity, {});
		await em.nativeDelete(ChatEntity, {});

		const chat = em.create(ChatEntity, {
			type: 'phase',
			phase: 'research',
			phase_index: 0,
			total_cost: 0.042,
			project: projectId,
		});
		await em.flush();
		chatId = chat.id;

		const message = em.create(ChatMessageEntity, {
			role: 'assistant',
			content: 'Test response',
			chat: chatId,
			metadata: {
				preset: 'fast',
				inference: { provider: 'anthropic' },
				usage: { prompt_tokens: 50, completion_tokens: 25 },
				model_name: 'claude-4',
			},
			debug_data: { raw_response: 'debug info here' },
		});
		await em.flush();
	});

	it('loaded ChatEntity includes total_cost when dev group is active', async () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const chat = await em.findOneOrFail(ChatEntity, chatId);

		const obj = wrap(chat).toObject();
		expect(obj).toHaveProperty('total_cost');
		expect(Number(obj.total_cost)).toBeCloseTo(0.042, 3);
	});

	it('loaded ChatEntity excludes total_cost when no groups active', async () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const chat = await em.findOneOrFail(ChatEntity, chatId);

		const obj = wrap(chat).toObject();
		expect(obj).not.toHaveProperty('total_cost');
		// But the entity itself still has the value
		expect(Number(chat.total_cost)).toBeCloseTo(0.042, 3);
	});

	it('loaded ChatEntity respects request-level group override', async () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		em.addSerializationGroups('dev');
		const chat = await em.findOneOrFail(ChatEntity, chatId);

		const obj = wrap(chat).toObject();
		expect(obj).toHaveProperty('total_cost');
	});

	it('loaded ChatMessageEntity hides debug_data and strips dev metadata', async () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = await em.findOneOrFail(ChatMessageEntity, { chat: chatId });

		const json = msg.toJSON();
		expect(json).not.toHaveProperty('debug_data');

		const meta = json.metadata as Record<string, unknown>;
		expect(meta).not.toHaveProperty('preset');
		expect(meta).not.toHaveProperty('inference');
		expect(meta).not.toHaveProperty('usage');
		expect(meta).toHaveProperty('model_name', 'claude-4');
	});

	it('loaded ChatMessageEntity keeps all metadata with dev group', async () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const msg = await em.findOneOrFail(ChatMessageEntity, { chat: chatId });

		const json = msg.toJSON();
		expect(json).not.toHaveProperty('debug_data'); // always hidden

		const meta = json.metadata as Record<string, unknown>;
		expect(meta).toHaveProperty('preset', 'fast');
		expect(meta).toHaveProperty('inference');
		expect(meta).toHaveProperty('usage');
		expect(meta).toHaveProperty('model_name', 'claude-4');
	});

	it('forked EM with excluded dev group strips metadata from loaded entity', async () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		em.excludeSerializationGroups('dev');
		const msg = await em.findOneOrFail(ChatMessageEntity, { chat: chatId });

		const json = msg.toJSON();
		const meta = json.metadata as Record<string, unknown>;
		expect(meta).not.toHaveProperty('preset');
		expect(meta).not.toHaveProperty('inference');
		expect(meta).not.toHaveProperty('usage');
	});
});
