import { z } from 'zod';
import { SEARCH_PARAMS } from '@/lib/search-params';

type SearchParamsLike =
    | URLSearchParams
    | { get(name: string): string | null }
    | Record<string, string | string[] | undefined>;

export const ProjectOriginSchema = z.object({
    origin: z.literal('project'),
    projectId: z.string().uuid(),
    sourceChatId: z.string().uuid().optional(),
});

export type ProjectOrigin = z.infer<typeof ProjectOriginSchema>;

function readSearchParam(input: SearchParamsLike, key: keyof ProjectOrigin): string | undefined {
    if ('get' in input && typeof input.get === 'function') {
        return input.get(key) ?? undefined;
    }

    const record = input as Record<string, string | string[] | undefined>;
    const value = record[key];
    return Array.isArray(value) ? value[0] : value;
}

export function parseProjectOrigin(input: SearchParamsLike): ProjectOrigin | null {
    const parsed = ProjectOriginSchema.safeParse({
        origin: readSearchParam(input, 'origin'),
        projectId: readSearchParam(input, 'projectId'),
        sourceChatId: readSearchParam(input, 'sourceChatId'),
    });

    return parsed.success ? parsed.data : null;
}

export function buildProjectOriginQuery(origin: ProjectOrigin): string {
    const params = new URLSearchParams({
        origin: origin.origin,
        projectId: origin.projectId,
    });

    if (origin.sourceChatId) {
        params.set('sourceChatId', origin.sourceChatId);
    }

    return params.toString();
}

export function buildProjectReturnHref(
    origin: ProjectOrigin,
    opts?: {
        highlightResource?: string;
    },
): string {
    const basePath = origin.sourceChatId ? `/${origin.projectId}/${origin.sourceChatId}` : `/${origin.projectId}`;
    const params = new URLSearchParams();

    if (!origin.sourceChatId) {
        params.set('new', 'true');
    }

    params.set(SEARCH_PARAMS.OPEN_PANEL, 'resources');

    if (opts?.highlightResource) {
        params.set(SEARCH_PARAMS.HIGHLIGHT_RESOURCE, opts.highlightResource);
    }

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
}
