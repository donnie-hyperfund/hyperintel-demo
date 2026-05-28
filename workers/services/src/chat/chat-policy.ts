import {
    type SubscribeInfoRequest,
    SubscribeInfoRequestSchema,
    type SubscribeInfoResponse,
} from '@/lib/schema/subscribe-info';
import createNeonSql from '@/workers/_common/vendor/neon';

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
type CreateSql = (env: ServicesEnv, previewAlias?: string) => Promise<SqlClient>;

const DENY_RESPONSE: SubscribeInfoResponse = { allowed: false };

function isWellFormedTopic(request: SubscribeInfoRequest): boolean {
    return request.topic === `${request.prefix}:${request.identifier}`;
}

async function getChatSubscribeInfo(sql: SqlClient, userId: string, chatId: string): Promise<SubscribeInfoResponse> {
    const rows = await sql`
		SELECT c.selected_model, c.completion_brief_status, c.active_agent_message_id
		FROM chats c
		JOIN projects p ON c.project_id = p.id
		JOIN users u ON p.user_id = u.id
		WHERE c.id = ${chatId} AND u.clerk_id = ${userId}
		LIMIT 1
	`;
    const row = rows[0];
    if (!row) return DENY_RESPONSE;

    return {
        allowed: true,
        activeAgentMessageId: (row.active_agent_message_id as string | null | undefined) ?? null,
        selectedModel: (row.selected_model as string | null | undefined) ?? null,
        completionBriefStatus: (row.completion_brief_status as string | null | undefined) ?? null,
    };
}

async function getIntakeSubscribeInfo(sql: SqlClient, userId: string, chatId: string): Promise<SubscribeInfoResponse> {
    const rows = await sql`
		SELECT c.active_agent_message_id
		FROM chats c
		JOIN users u ON c.user_id = u.id
		WHERE c.id = ${chatId} AND c.type = 'intake' AND u.clerk_id = ${userId}
		LIMIT 1
	`;
    const row = rows[0];
    if (!row) return DENY_RESPONSE;
    return {
        allowed: true,
        activeAgentMessageId: (row.active_agent_message_id as string | null | undefined) ?? null,
    };
}

export async function getTopicSubscribeInfo(
    env: ServicesEnv,
    rawRequest: unknown,
    createSql: CreateSql = createNeonSql as CreateSql,
): Promise<SubscribeInfoResponse> {
    const parsed = SubscribeInfoRequestSchema.safeParse(rawRequest);
    if (!parsed.success || !isWellFormedTopic(parsed.data)) {
        return DENY_RESPONSE;
    }

    try {
        const { userId, prefix, identifier, previewAlias } = parsed.data;
        const sql = await createSql(env, previewAlias ?? undefined);

        if (prefix === 'chat') {
            return await getChatSubscribeInfo(sql, userId, identifier);
        }

        if (prefix === 'intake') {
            return await getIntakeSubscribeInfo(sql, userId, identifier);
        }

        return DENY_RESPONSE;
    } catch (error) {
        console.error('[services] subscribe-info failed closed', error);
        return DENY_RESPONSE;
    }
}
