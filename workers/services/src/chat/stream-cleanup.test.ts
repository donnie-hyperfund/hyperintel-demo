import { describe, expect, it, vi } from 'vitest';
import createNeonSql from '@/workers/_common/vendor/neon';
import { clearActiveStream, deadManCleanup } from './stream-cleanup';
import { ChatServices } from '../index';

vi.mock('@/workers/_common/vendor/neon', () => ({
    default: vi.fn(),
}));

function makeSql() {
    return vi.fn(async () => []);
}

function sqlText(call: unknown[]): string {
    return (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ').trim();
}

const env = {} as ServicesEnv;

describe('clearActiveStream', () => {
    it('clears active_agent_message_id for a matching chat stream', async () => {
        const sql = makeSql();

        await clearActiveStream(
            env,
            {
                topic: 'chat:chat-1',
                prefix: 'chat',
                identifier: 'chat-1',
                agentMessageId: 'agent-1',
                previewAlias: 'branch-a',
            },
            async () => sql,
        );

        expect(sql).toHaveBeenCalledTimes(1);
    });

    it('treats zero-row updates as an idempotent no-op', async () => {
        const sql = vi.fn(async () => []);

        await expect(
            clearActiveStream(
                env,
                {
                    topic: 'chat:chat-1',
                    prefix: 'chat',
                    identifier: 'chat-1',
                    agentMessageId: 'stale-agent',
                },
                async () => sql,
            ),
        ).resolves.toBeUndefined();
        expect(sql).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed topic requests before SQL', async () => {
        const sql = makeSql();

        await expect(
            clearActiveStream(
                env,
                {
                    topic: 'chat:other-chat',
                    prefix: 'chat',
                    identifier: 'chat-1',
                    agentMessageId: 'agent-1',
                },
                async () => sql,
            ),
        ).rejects.toThrow('invalid clear-active-stream request');
        expect(sql).not.toHaveBeenCalled();
    });

    it('exposes cleanup through the ChatServices entrypoint with its bound env', async () => {
        const entryEnv = { WORKER_NAME_FULL: 'hi-services-test' } as ServicesEnv;
        const sql = makeSql();
        vi.mocked(createNeonSql).mockResolvedValueOnce(sql as unknown as Awaited<ReturnType<typeof createNeonSql>>);

        const entrypoint = new ChatServices({} as ExecutionContext, entryEnv);
        await entrypoint.clearActiveStream({
            topic: 'intake:intake-1',
            prefix: 'intake',
            identifier: 'intake-1',
            agentMessageId: 'agent-1',
            previewAlias: 'branch-a',
        });

        expect(createNeonSql).toHaveBeenCalledWith(entryEnv, 'branch-a');
        expect(sql).toHaveBeenCalledTimes(1);
    });
});

describe('deadManCleanup', () => {
    it('inserts an errored placeholder before clearing the active stream', async () => {
        const sql = makeSql();

        await deadManCleanup(
            env,
            {
                topic: 'chat:chat-1',
                prefix: 'chat',
                identifier: 'chat-1',
                agentMessageId: 'agent-1',
                previewAlias: 'branch-a',
            },
            async () => sql,
        );

        expect(sql).toHaveBeenCalledTimes(2);
        expect(sqlText(sql.mock.calls[0])).toContain('INSERT INTO chat_messages');
        expect(sqlText(sql.mock.calls[0])).toContain('ON CONFLICT (id) DO NOTHING');
        expect(sqlText(sql.mock.calls[1])).toContain('UPDATE chats SET active_agent_message_id = NULL');
    });

    it('treats existing placeholder rows as idempotent no-ops', async () => {
        const sql = vi.fn(async () => []);

        await expect(
            deadManCleanup(
                env,
                {
                    topic: 'chat:chat-1',
                    prefix: 'chat',
                    identifier: 'chat-1',
                    agentMessageId: 'agent-1',
                },
                async () => sql,
            ),
        ).resolves.toBeUndefined();
        expect(sql).toHaveBeenCalledTimes(2);
    });

    it('keeps dead-man cleanup idempotent when the active stream has moved on', async () => {
        const sql = vi.fn(async () => []);

        await expect(
            deadManCleanup(
                env,
                {
                    topic: 'chat:chat-1',
                    prefix: 'chat',
                    identifier: 'chat-1',
                    agentMessageId: 'stale-agent',
                },
                async () => sql,
            ),
        ).resolves.toBeUndefined();

        expect(sql).toHaveBeenCalledTimes(2);
        expect(sqlText(sql.mock.calls[0])).toContain('INSERT INTO chat_messages');
        expect(sqlText(sql.mock.calls[1])).toContain('WHERE id = ? AND active_agent_message_id = ?');
    });

    it('rejects malformed dead-man requests before SQL', async () => {
        const sql = makeSql();

        await expect(
            deadManCleanup(
                env,
                {
                    topic: 'chat:other-chat',
                    prefix: 'chat',
                    identifier: 'chat-1',
                    agentMessageId: 'agent-1',
                },
                async () => sql,
            ),
        ).rejects.toThrow('invalid dead-man-cleanup request');
        expect(sql).not.toHaveBeenCalled();
    });

    it('exposes dead-man cleanup through the ChatServices entrypoint with its bound env', async () => {
        const entryEnv = { WORKER_NAME_FULL: 'hi-services-test' } as ServicesEnv;
        const sql = makeSql();
        vi.mocked(createNeonSql).mockResolvedValueOnce(sql as unknown as Awaited<ReturnType<typeof createNeonSql>>);

        const entrypoint = new ChatServices({} as ExecutionContext, entryEnv);
        await entrypoint.deadManCleanup({
            topic: 'intake:intake-1',
            prefix: 'intake',
            identifier: 'intake-1',
            agentMessageId: 'agent-1',
            previewAlias: 'branch-a',
        });

        expect(createNeonSql).toHaveBeenCalledWith(entryEnv, 'branch-a');
        expect(sql).toHaveBeenCalledTimes(2);
    });
});
