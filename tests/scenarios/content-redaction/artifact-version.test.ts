/**
 * Tests that ArtifactVersionEntity serialization conditionally redacts content
 * based on the is_internal flag.
 *
 * - ai_content is ALWAYS stripped regardless of is_internal
 * - is_internal=true (default): content is also stripped
 * - is_internal=false: content is exposed
 *
 * Uses a minimal MikroORM instance (no DB) to verify toJSON() behavior.
 */

import { MikroORM, wrap } from '@mikro-orm/core';
import { defineConfig } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';

let orm: MikroORM;

beforeAll(async () => {
    orm = await MikroORM.init(
        defineConfig({
            clientUrl: 'postgresql://fake:fake@localhost:5432/fake',
            connect: false,
            allowGlobalContext: true,
            entities: [ArtifactVersionEntity, ArtifactEntity, ChatMessageEntity, ChatEntity, ProjectEntity, UserEntity],
        }),
    );
});

afterAll(async () => {
    await orm?.close();
});

const now = new Date('2026-01-01T00:00:00Z');
let idCounter = 0;

function createVersion(
    overrides: Partial<{
        id: string;
        version: number;
        content: string;
        ai_content: string;
        status: string;
        rejection_reason: string;
        is_internal: boolean;
    }> = {},
) {
    idCounter++;
    return orm.em.create(ArtifactVersionEntity, {
        id: `00000000-0000-0000-0000-${String(idCounter).padStart(12, '0')}`,
        version: 1,
        title: 'Test Artifact',
        content: 'document body',
        ai_content: 'AI-generated YAML',
        status: 'approved',
        artifact: '00000000-0000-0000-0000-000000000099' as any,
        created_at: now,
        ...overrides,
    } as any);
}

describe('ArtifactVersionEntity serialization', () => {
    describe('internal documents (is_internal=true, default)', () => {
        it('redacts content', () => {
            const json = wrap(createVersion()).toJSON();
            expect(json.content).toBeUndefined();
        });

        it('redacts ai_content', () => {
            const json = wrap(createVersion()).toJSON();
            expect(json.ai_content).toBeUndefined();
        });

        it('defaults to is_internal=true when not specified', () => {
            const version = createVersion();
            expect(version.is_internal).toBe(true);
        });

        it('exposes non-sensitive fields', () => {
            const json = wrap(
                createVersion({
                    version: 3,
                    status: 'rejected',
                    rejection_reason: 'Does not meet requirements',
                }),
            ).toJSON();

            expect(json.version).toBe(3);
            expect(json.status).toBe('rejected');
            expect(json.rejection_reason).toBe('Does not meet requirements');
            expect(json.is_internal).toBe(true);
        });
    });

    describe('client deliverable documents (is_internal=false)', () => {
        it('exposes content', () => {
            const json = wrap(createVersion({ is_internal: false })).toJSON();
            expect(json.content).toBe('document body');
        });

        it('still redacts ai_content', () => {
            const json = wrap(createVersion({ is_internal: false })).toJSON();
            expect(json.ai_content).toBeUndefined();
        });

        it('exposes non-sensitive fields', () => {
            const json = wrap(
                createVersion({
                    version: 2,
                    status: 'proposed',
                    is_internal: false,
                }),
            ).toJSON();

            expect(json.version).toBe(2);
            expect(json.status).toBe('proposed');
            expect(json.is_internal).toBe(false);
        });
    });
});
