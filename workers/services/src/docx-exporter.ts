import markdownDocx, { Packer } from '@jinzhongjia/markdown-docx';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { initMikroOrmWorker } from '@/workers/_common/vendor/mikro';
import { getConnectionString, isHyperdriveEnv, type PostgresEnv } from '@/workers/_common/vendor/postgres';

export interface ExportArtifactVersionDocxInput {
    artifactVersionId: string;
    userId: string;
    previewAlias?: string | null;
}

export type ExportArtifactVersionDocxResult =
    | {
          ok: true;
          buffer: ArrayBuffer;
          filename: string;
          contentType: string;
      }
    | {
          ok: false;
          status: number;
          message: string;
          code: string;
      };

export async function exportArtifactVersionDocx(
    input: ExportArtifactVersionDocxInput,
    env: PostgresEnv,
): Promise<ExportArtifactVersionDocxResult> {
    if (!process.versions?.node) {
        // @ts-ignore Worker/node compatibility shim matches context.helpers.ts.
        process.versions = { ...process.versions, node: '20.17.0' };
    }

    const clientUrl = await getConnectionString(env, input.previewAlias ?? undefined);
    const useNoSSL = isHyperdriveEnv(env) || clientUrl.endsWith('sslmode=disable');
    const orm = await initMikroOrmWorker({
        clientUrl,
        ...(useNoSSL && { driverOptions: { connection: { ssl: false } } }),
    });
    const em = orm.em.fork();

    try {
        const version = await em
            .createQueryBuilder(ArtifactVersionEntity, 'v')
            .select('v.*')
            .leftJoinAndSelect('v.artifact', 'a')
            .leftJoinAndSelect('a.project', 'p')
            .leftJoinAndSelect('p.user', 'u')
            .where({
                'v.id': input.artifactVersionId,
                'u.clerkId': input.userId,
            })
            .getSingleResult();

        if (!version || version.is_internal) {
            return {
                ok: false,
                status: 404,
                message: 'Version not found or access denied',
                code: 'VERSION_NOT_FOUND',
            };
        }

        const doc = await markdownDocx(version.content ?? '', {
            ignoreImage: true,
            document: { title: version.title },
        });

        return {
            ok: true,
            buffer: await Packer.toArrayBuffer(doc),
            filename: `${sanitizeFilename(version.title)}.docx`,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
    } finally {
        em.clear();
        await orm.close(true);
    }
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 200);
}
