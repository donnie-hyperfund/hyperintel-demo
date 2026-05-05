import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { approveArtifactHandler, approveArtifactProgrammatic } from './artifact-approver';

vi.mock('./tools/documents/document-classifier', () => ({
    shouldGenerateAiContent: vi.fn(async () => false),
}));

vi.mock('@/lib/artifacts/publish', () => ({
    publishArtifactToUserScope: vi.fn(),
}));

function buildVersion(documentType = 'Other', summaryInternal: string | null = 'internal summary') {
    const chat = {
        id: 'chat-1',
        type: 'phase',
        name: 'Phase 1',
        phase_index: 0,
        completion_brief_status: null,
    };
    const projectUser = { id: 'user-db-1', clerkId: 'user-1' };
    const project = { id: 'project-1', name: 'Project', user: projectUser };
    const artifact = {
        id: 'artifact-1',
        key: documentType === 'Completion Brief' ? 'completion-brief.md' : 'report.md',
        project,
        user: projectUser,
        current_version: null,
    };
    const version = {
        id: 'version-1',
        version: 2,
        title: 'Report',
        content: 'content',
        ai_content: null,
        status: 'proposed',
        status_changed_at: null,
        status_changed_by: null,
        document_type: documentType,
        summary_internal: summaryInternal,
        artifact,
        chat,
    } as any;
    return { version, artifact, chat };
}

function buildCtx(version: any, cbChat = version.chat) {
    const persisted: any[] = [];
    const ugStub = {
        systemAction: vi.fn(async () => undefined),
        broadcastToAll: vi.fn(async () => undefined),
    };
    const qb = {
        select: vi.fn(() => qb),
        leftJoinAndSelect: vi.fn(() => qb),
        where: vi.fn(() => qb),
        getSingleResult: vi.fn(async () => version),
    };
    const em = {
        createQueryBuilder: vi.fn(() => qb),
        findOne: vi.fn(async (entity: unknown) => (entity === ChatEntity ? cbChat : null)),
        find: vi.fn(async () => []),
        create: vi.fn((_entity: unknown, data: Record<string, unknown>) => {
            const msg = { ...data, toJSON: () => data };
            return msg;
        }),
        persist: vi.fn((entity: unknown) => persisted.push(entity)),
        flush: vi.fn(async () => undefined),
    };
    const ctx = {
        em,
        env: {
            USER_GATEWAY: {
                idFromName: vi.fn(() => 'ug-id'),
                get: vi.fn(() => ugStub),
            },
        },
        user: { userId: 'user-1' },
        previewAlias: null,
    } as any;
    return { ctx, em, qb, persisted, ugStub };
}

describe('artifact approval system events', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('programmatic approval injects artifact_auto_approved and preserves summary_internal', async () => {
        const { version, artifact, chat } = buildVersion('Completion Brief');
        const { ctx, persisted, ugStub } = buildCtx(version, chat);

        const result = await approveArtifactProgrammatic(ctx, 'version-1', { reason: 'context_hard_gate' });

        expect(result).toMatchObject({ success: true, status: 'approved', chatId: 'chat-1' });
        expect(version.status).toBe('approved');
        expect(version.summary_internal).toBe('internal summary');
        expect(artifact.current_version).toBe(version);
        expect(chat.completion_brief_status).toBe('approved');
        expect(persisted.at(-1)).toMatchObject({
            role: 'user',
            content: expect.stringContaining('auto-approved'),
            metadata: expect.objectContaining({
                systemEvent: 'artifact_auto_approved',
                reason: 'context_hard_gate',
                versionId: 'version-1',
            }),
        });
        expect(ugStub.systemAction).toHaveBeenCalledWith(
            'chat:chat-1',
            'cbStatusChanged',
            { status: 'approved' },
            undefined,
        );
        expect(ugStub.systemAction).toHaveBeenCalledWith(
            'chat:chat-1',
            'messageCreated',
            expect.objectContaining({
                message: expect.objectContaining({
                    metadata: expect.objectContaining({ systemEvent: 'artifact_auto_approved' }),
                }),
            }),
            undefined,
        );
    });

    it('programmatic approval succeeds and leaves missing summary_internal missing', async () => {
        const { version, artifact, chat } = buildVersion('Completion Brief', null);
        const { ctx, persisted } = buildCtx(version, chat);

        const result = await approveArtifactProgrammatic(ctx, 'version-1', { reason: 'context_hard_gate' });

        expect(result).toMatchObject({ success: true, status: 'approved', chatId: 'chat-1' });
        expect(version.status).toBe('approved');
        expect(version.summary_internal).toBeNull();
        expect(artifact.current_version).toBe(version);
        expect(chat.completion_brief_status).toBe('approved');
        expect(persisted.at(-1)).toMatchObject({
            metadata: expect.objectContaining({
                systemEvent: 'artifact_auto_approved',
                reason: 'context_hard_gate',
            }),
        });
    });

    it('public approval injects artifact_approved, not artifact_auto_approved', async () => {
        const { version, artifact } = buildVersion('Other');
        const { ctx, persisted } = buildCtx(version);

        const result = await approveArtifactHandler({ versionId: 'version-1' }, ctx);

        expect(result).toMatchObject({ success: true, status: 'approved', yamlGenerated: false });
        expect(version.status).toBe('approved');
        expect(artifact.current_version).toBe(version);
        expect(persisted.at(-1)).toMatchObject({
            role: 'user',
            content: '<system>User has approved artifact [report.md] v2</system>',
            metadata: expect.objectContaining({
                systemEvent: 'artifact_approved',
                artifactId: 'artifact-1',
                versionId: 'version-1',
            }),
        });
        expect(persisted.at(-1).metadata.systemEvent).not.toBe('artifact_auto_approved');
    });
});
