import type { QueryBuilder } from '@mikro-orm/postgresql';

export interface PaginationParams {
    page?: number;
    limit?: number;
}

export interface PaginationResult {
    offset: number;
    limit: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface ListData {
    page: number;
    perPage: number;
}

export interface SortData {
    field: string;
    direction: 'ASC' | 'DESC';
}

export interface ListSortData extends ListData {
    sort: SortData;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePaginationParams(params: PaginationParams): PaginationResult {
    const page = Math.max(1, params.page ?? DEFAULT_PAGE);
    const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit;

    return { offset, limit };
}

export async function getPaginatedResult<T extends object>(
    query: QueryBuilder<T>,
    args: ListSortData | ListData,
    sortMap?: Record<string, string>,
): Promise<{ nodes: T[]; totalCount: number }> {
    if ('sort' in args && sortMap) {
        const column = sortMap[args.sort.field];
        if (column) {
            query.orderBy({ [column]: args.sort.direction.replaceAll('_', ' ') } as any);
        }
    }

    query.limit(args.perPage).offset((args.page - 1) * args.perPage);

    const [nodes, totalCount] = await query.getResultAndCount();

    return { nodes, totalCount };
}

export function createPaginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
): PaginatedResponse<T> {
    return {
        data,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}
