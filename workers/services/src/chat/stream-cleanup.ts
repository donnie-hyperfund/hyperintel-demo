import {
    type ClearActiveStreamRequest,
    ClearActiveStreamRequestSchema,
    type DeadManCleanupRequest,
    DeadManCleanupRequestSchema,
    type StreamParityDebugRequest,
    StreamParityDebugRequestSchema,
} from '@/lib/schema/stream-cleanup';
import createNeonSql from '@/workers/_common/vendor/neon';

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
type CreateSql = (env: ServicesEnv, previewAlias?: string) => Promise<SqlClient>;

function isWellFormedTopic(request: ClearActiveStreamRequest): boolean {
    return request.topic === `${request.prefix}:${request.identifier}`;
}

function parseClearActiveStreamRequest(rawRequest: unknown): ClearActiveStreamRequest {
    const parsed = ClearActiveStreamRequestSchema.safeParse(rawRequest);
    if (!parsed.success || !isWellFormedTopic(parsed.data)) {
        throw new Error('[services] invalid clear-active-stream request');
    }
    return parsed.data;
}

function parseDeadManCleanupRequest(rawRequest: unknown): DeadManCleanupRequest {
    const parsed = DeadManCleanupRequestSchema.safeParse(rawRequest);
    if (!parsed.success || !isWellFormedTopic(parsed.data)) {
        throw new Error('[services] invalid dead-man-cleanup request');
    }
    return parsed.data;
}

function parseStreamParityDebugRequest(rawRequest: unknown): StreamParityDebugRequest {
    const parsed = StreamParityDebugRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
        throw new Error('[services] invalid stream-parity-debug request');
    }
    return parsed.data;
}

async function clearActiveAgentMessageId(sql: SqlClient, request: ClearActiveStreamRequest): Promise<void> {
    await sql`
		UPDATE chats SET active_agent_message_id = NULL
		WHERE id = ${request.identifier} AND active_agent_message_id = ${request.agentMessageId}
	`;
}

async function insertErroredPlaceholderMessage(sql: SqlClient, request: DeadManCleanupRequest): Promise<void> {
    await sql`
		INSERT INTO chat_messages (id, created_at, role, content, chat_id, blocks, is_error)
		VALUES (${request.agentMessageId}, NOW(), 'assistant', '', ${request.identifier}, '[]'::jsonb, true)
		ON CONFLICT (id) DO NOTHING
	`;
}

export async function clearActiveStream(
    env: ServicesEnv,
    rawRequest: unknown,
    createSql: CreateSql = createNeonSql as CreateSql,
): Promise<void> {
    const request = parseClearActiveStreamRequest(rawRequest);
    const sql = await createSql(env, request.previewAlias ?? undefined);
    await clearActiveAgentMessageId(sql, request);
}

export async function deadManCleanup(
    env: ServicesEnv,
    rawRequest: unknown,
    createSql: CreateSql = createNeonSql as CreateSql,
): Promise<void> {
    const request = parseDeadManCleanupRequest(rawRequest);
    const sql = await createSql(env, request.previewAlias ?? undefined);
    await insertErroredPlaceholderMessage(sql, request);
    await clearActiveAgentMessageId(sql, request);
}

export async function recordStreamParityDebug(
    env: ServicesEnv,
    rawRequest: unknown,
    createSql: CreateSql = createNeonSql as CreateSql,
): Promise<void> {
    const request = parseStreamParityDebugRequest(rawRequest);
    const sql = await createSql(env, request.previewAlias ?? undefined);
    await sql`
		UPDATE chat_messages
		SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('streamParityDebug', ${JSON.stringify(request.debug)}::jsonb)
		WHERE id = ${request.agentMessageId}
	`;
}
