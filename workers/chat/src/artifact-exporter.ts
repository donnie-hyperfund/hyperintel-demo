import { PublicError } from '@common/common/error.helpers';
import markdownDocx, { Packer } from '@jinzhongjia/markdown-docx';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import type { ExportArtifactQueryDto } from '@/lib/schema/artifact';
import { Ctx } from './context';

export async function exportArtifactHandler(data: ExportArtifactQueryDto, ctx: Ctx): Promise<Response> {
    const { artifactVersionId, format } = data;
    const { em, user } = ctx;

    if (!em) {
        throw new PublicError(500, { message: 'Database connection not available', code: 'DATABASE_UNAVAILABLE' });
    }

    const version = await em
        .createQueryBuilder(ArtifactVersionEntity, 'v')
        .select('v.*')
        .leftJoinAndSelect('v.artifact', 'a')
        .leftJoinAndSelect('a.project', 'p')
        .leftJoinAndSelect('p.user', 'u')
        .where({
            'v.id': artifactVersionId,
            'u.clerkId': user.userId,
        })
        .getSingleResult();

    if (!version || version.is_internal) {
        throw new PublicError(404, { message: 'Version not found or access denied', code: 'VERSION_NOT_FOUND' });
    }

    if (format === 'docx') {
        return await convertToDocx(version.content, version.title);
    }

    throw new PublicError(400, { message: `Unsupported format: ${format}`, code: 'UNSUPPORTED_FORMAT' });
}

async function convertToDocx(markdown: string, title: string): Promise<Response> {
    const doc = await markdownDocx(markdown, {
        ignoreImage: true,
        document: { title },
    });

    const buffer = await Packer.toArrayBuffer(doc);
    const filename = `${sanitizeFilename(title)}.docx`;

    return new Response(buffer, {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
    });
}

function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 200);
}
