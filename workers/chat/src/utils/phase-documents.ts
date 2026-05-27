import { raw } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';

export interface PhaseDocument {
    name: string;
    title: string;
    version: number;
    status: string;
    contentPreview?: string;
}

type PhaseDocumentRow = {
    artifact_key: string | null;
    title: string;
    version: number;
    status: string;
    content_preview: string | null;
};

/**
 * Load a chat's documents as artifact-version rows with a 500-char preview —
 * a direct DB query that avoids loading the full message history into memory
 * (phase transition / completion brief run when context is already at capacity).
 */
export async function loadPhaseDocuments(em: EntityManager, chatId: string): Promise<PhaseDocument[]> {
    const rows = (await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select([
            'a.key as artifact_key',
            'v.title as title',
            'v.version as version',
            'v.status as status',
            raw('left(v.content, 500)').as('content_preview'),
        ])
        .leftJoin('v.artifact', 'a')
        .where({ 'v.chat': chatId })
        .orderBy({ 'v.created_at': 'ASC' })
        .execute('all')) as PhaseDocumentRow[];

    return rows.map((row) => ({
        name: row.artifact_key ?? row.title,
        title: row.title,
        version: row.version,
        status: row.status,
        contentPreview: row.content_preview ?? undefined,
    }));
}
