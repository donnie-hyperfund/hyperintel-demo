import { PublicError } from '@common/common/error.helpers';
import { normalizeArtifactKey, UPLOAD_ERROR_CODES, validateArtifactFile } from '@/lib/artifacts/utils';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { type UploadArtifactDto } from '@/lib/schema/artifact';
import { Ctx } from './context';

// TODO: Add `overwrite_version` param to confirm overwriting a specific version
export async function uploadArtifactHandler(data: UploadArtifactDto, ctx: Ctx) {
    const { file, projectId, chatId, title: titleInput } = data;
    const { em, user } = ctx;

    const validation = validateArtifactFile(file);
    if (validation) {
        throw new PublicError(400, { message: validation.message, code: validation.code });
    }

    // TODO: .docx :/
    const content = await file.text();
    if (!content.trim()) {
        throw new PublicError(400, {
            message: 'The uploaded file has no content',
            code: UPLOAD_ERROR_CODES.EMPTY_FILE,
        });
    }

    const title = titleInput || file.name.replace(/\.[^.]+$/, '');
    const normalizedKey = normalizeArtifactKey(file.name);

    // Check project exists and user has access
    const project = await em!.findOneOrFail(ProjectEntity, {
        id: projectId,
        user: { clerkId: user.userId },
    });

    if (chatId) {
        // Validate chat belongs to project
        await em!.findOneOrFail(ChatEntity, { id: chatId, project: projectId });
    }

    const existing = await em.findOne(
        ArtifactEntity,
        { project: projectId, key: normalizedKey },
        { populate: ['current_version', 'versions'] },
    );

    if (existing) {
        const versions = existing.versions.getItems();
        const maxVersion = Math.max(...versions.map((v) => v.version), 0);
        const newVersionNum = maxVersion + 1;

        const existingProposed = versions.find((v) => v.status === 'proposed');
        const supersededVersion = existingProposed?.version;

        if (existingProposed) {
            existingProposed.status = 'superseded';
            existingProposed.rejection_reason = `Superseded by uploaded v${newVersionNum}`;
            existingProposed.status_changed_at = new Date();
        }

        const newVersion = new ArtifactVersionEntity();
        newVersion.artifact = existing;
        newVersion.version = newVersionNum;
        newVersion.content = content;
        newVersion.status = 'approved';
        newVersion.is_internal = false; // User uploads are client deliverables
        newVersion.is_uploaded = true;
        newVersion.status_changed_at = new Date();
        newVersion.status_changed_by = project.id;
        if (chatId) {
            newVersion.chat = em.getReference('ChatEntity', chatId) as any;
        }

        em.persist(newVersion);

        existing.version = newVersionNum;
        existing.title = title;
        existing.current_version = newVersion;

        await em.flush();

        return {
            success: true,
            action: 'new_version' as const,
            artifactId: existing.id,
            versionId: newVersion.id,
            version: newVersionNum,
            key: normalizedKey,
            supersededVersion,
        };
    }

    let artifactId = '';
    let versionId = '';

    await em.transactional(async (txEm) => {
        const artifact = new ArtifactEntity();
        artifact.key = normalizedKey;
        artifact.title = title;
        artifact.version = 1;
        artifact.project = txEm.getReference('ProjectEntity', projectId) as any;

        txEm.persist(artifact);
        await txEm.flush();

        const version = new ArtifactVersionEntity();
        version.artifact = artifact;
        version.version = 1;
        version.content = content;
        version.status = 'approved';
        version.is_internal = false; // User uploads are client deliverables
        version.is_uploaded = true;
        version.status_changed_at = new Date();
        version.status_changed_by = project.id;
        if (chatId) {
            version.chat = txEm.getReference('ChatEntity', chatId) as any;
        }

        txEm.persist(version);
        await txEm.flush();

        artifact.current_version = version;
        await txEm.flush();

        artifactId = artifact.id;
        versionId = version.id;
    });

    return {
        success: true,
        action: 'created' as const,
        artifactId,
        versionId,
        version: 1,
        key: normalizedKey,
    };
}
