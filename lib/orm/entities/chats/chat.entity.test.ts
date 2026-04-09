/**
 * Tests that ChatEntity serialization respects @Property({ groups: ['dev'] })
 * on total_cost — filtered automatically by the patched toObject.
 */

import { wrap } from '@mikro-orm/core';
import { MikroORM, defineConfig } from '@mikro-orm/postgresql';
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

function createChat(em: ScopedEntityManager): ChatEntity {
	const entity = em.create(ChatEntity, {
		id: '00000000-0000-0000-0000-000000000001',
		type: 'phase',
		phase: 'research',
		phase_index: 0,
		total_cost: 1.234567,
		created_at: new Date('2026-01-01'),
		updated_at: new Date('2026-01-01'),
	});
	em.getUnitOfWork().merge(entity);
	return entity;
}

describe('ChatEntity serialization — total_cost group filtering', () => {
	it('includes total_cost when dev group is active (deployment-level)', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		const chat = createChat(em);

		const obj = wrap(chat).toObject();
		expect(obj).toHaveProperty('total_cost');
		expect(obj.total_cost).toBe(1.234567);
	});

	it('excludes total_cost when no groups are active', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const chat = createChat(em);

		const obj = wrap(chat).toObject();
		expect(obj).not.toHaveProperty('total_cost');
	});

	it('includes total_cost when dev group is added at request level', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		em.addSerializationGroups('dev');
		const chat = createChat(em);

		const obj = wrap(chat).toObject();
		expect(obj).toHaveProperty('total_cost');
	});

	it('excludes total_cost when dev is deployment-level but excluded at request level', () => {
		setDeploymentGroups(orm, ['dev']);
		const em = orm.em.fork() as ScopedEntityManager;
		em.excludeSerializationGroups('dev');
		const chat = createChat(em);

		const obj = wrap(chat).toObject();
		expect(obj).not.toHaveProperty('total_cost');
	});

	it('always includes non-grouped properties regardless of active groups', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const chat = createChat(em);

		const obj = wrap(chat).toObject();
		expect(obj).toHaveProperty('type', 'phase');
		expect(obj).toHaveProperty('phase', 'research');
		expect(obj).toHaveProperty('phase_index', 0);
	});

	it('total_cost is still accessible on the entity instance when group is inactive', () => {
		setDeploymentGroups(orm, []);
		const em = orm.em.fork() as ScopedEntityManager;
		const chat = createChat(em);

		// toObject filters it out, but the property is still there
		expect(chat.total_cost).toBe(1.234567);
		expect(wrap(chat).toObject()).not.toHaveProperty('total_cost');
	});
});
