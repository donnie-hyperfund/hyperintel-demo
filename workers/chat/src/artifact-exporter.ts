import { PublicError } from '@common/common/error.helpers';
import type { ExportArtifactQueryDto } from '@/lib/schema/artifact';
import { Ctx } from './context';

export async function exportArtifactHandler(data: ExportArtifactQueryDto, ctx: Ctx): Promise<Response> {
    const { artifactVersionId, format } = data;

    if (format === 'docx') {
        const result = await ctx.env.DOCX_EXPORT_SERVICE.exportArtifactVersionDocx({
            artifactVersionId,
            userId: ctx.user.userId,
            previewAlias: ctx.previewAlias,
        });

        if (!result.ok) {
            throw new PublicError(result.status, { message: result.message, code: result.code });
        }

        return new Response(result.buffer, {
            headers: {
                'Content-Type': result.contentType,
                'Content-Disposition': `attachment; filename="${result.filename}"`,
            },
        });
    }

    throw new PublicError(400, { message: `Unsupported format: ${format}`, code: 'UNSUPPORTED_FORMAT' });
}
