/**
 * Tests that ArtifactVersionEntity serialization strips content and ai_content.
 *
 * The entity uses MikroORM property serializers (`serializer: () => undefined`)
 * so content is never exposed through any endpoint that calls `wrap(entity).toJSON()`.
 *
 * This test initializes a minimal MikroORM instance (no DB connection) to verify
 * the serializer behavior through the actual ORM pipeline.
 */

import { MikroORM, wrap } from "@mikro-orm/core";
import { defineConfig } from "@mikro-orm/postgresql";

// Entity under test — and its dependencies (MikroORM needs the full graph)
import { ArtifactVersionEntity } from "@/lib/orm/entities/artifacts/artifact-version.entity";
import { ArtifactEntity } from "@/lib/orm/entities/artifacts/artifact.entity";
import { ChatMessageEntity } from "@/lib/orm/entities/chats/chat-message.entity";
import { ChatEntity } from "@/lib/orm/entities/chats/chat.entity";
import { ProjectEntity } from "@/lib/orm/entities/projects/project.entity";
import { UserEntity } from "@/lib/orm/entities/users/user.entity";

let orm: MikroORM;

beforeAll(async () => {
	orm = await MikroORM.init(
		defineConfig({
			// No actual DB — we only need metadata + serialization
			clientUrl: "postgresql://fake:fake@localhost:5432/fake",
			connect: false,
			allowGlobalContext: true,
			entities: [
				ArtifactVersionEntity,
				ArtifactEntity,
				ChatMessageEntity,
				ChatEntity,
				ProjectEntity,
				UserEntity,
			],
		}),
	);
});

afterAll(async () => {
	await orm?.close();
});

describe("ArtifactVersionEntity serialization", () => {
	const now = new Date("2026-01-01T00:00:00Z");

	it("serializes content as undefined", () => {
		const version = orm.em.create(ArtifactVersionEntity, {
			id: "00000000-0000-0000-0000-000000000001",
			version: 1,
			content: "This is the full artifact body — should never be exposed",
			status: "approved",
			artifact: "00000000-0000-0000-0000-000000000099" as any,
			created_at: now,
		});

		const json = wrap(version).toJSON();

		expect(json.content).toBeUndefined();
	});

	it("serializes ai_content as undefined", () => {
		const version = orm.em.create(ArtifactVersionEntity, {
			id: "00000000-0000-0000-0000-000000000002",
			version: 1,
			content: "visible",
			ai_content: "AI-generated content — also should never be exposed",
			status: "proposed",
			artifact: "00000000-0000-0000-0000-000000000099" as any,
			created_at: now,
		});

		const json = wrap(version).toJSON();

		expect(json.ai_content).toBeUndefined();
	});

	it("still exposes non-sensitive fields", () => {
		const version = orm.em.create(ArtifactVersionEntity, {
			id: "00000000-0000-0000-0000-000000000003",
			version: 3,
			content: "secret",
			status: "rejected",
			rejection_reason: "Does not meet requirements",
			artifact: "00000000-0000-0000-0000-000000000099" as any,
			created_at: now,
		});

		const json = wrap(version).toJSON();

		expect(json.version).toBe(3);
		expect(json.status).toBe("rejected");
		expect(json.rejection_reason).toBe("Does not meet requirements");
		expect(json.id).toBe("00000000-0000-0000-0000-000000000003");
	});
});
