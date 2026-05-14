import { describe, expect, it, vi } from 'vitest';
import createNeonSql from '@/workers/_common/vendor/neon';
import { getTopicSubscribeInfo } from './chat-policy';
import { ChatServices } from '../index';

vi.mock('@/workers/_common/vendor/neon', () => ({
    default: vi.fn(),
}));

function makeSql(rows: Record<string, unknown>[]) {
    return vi.fn(async () => rows);
}

const env = {} as ServicesEnv;

describe('getTopicSubscribeInfo', () => {
    it('allows a chat owner and returns chat subscribe metadata', async () => {
        const sql = makeSql([{ selected_model: 'sonnet', completion_brief_status: 'approved' }]);

        const result = await getTopicSubscribeInfo(
            env,
            {
                userId: 'user-1',
                topic: 'chat:chat-1',
                prefix: 'chat',
                identifier: 'chat-1',
                previewAlias: 'branch-a',
            },
            async () => sql,
        );

        expect(result).toEqual({
            allowed: true,
            selectedModel: 'sonnet',
            completionBriefStatus: 'approved',
        });
        expect(sql).toHaveBeenCalledTimes(1);
    });

    it('denies a chat non-owner without metadata', async () => {
        const sql = makeSql([]);

        const result = await getTopicSubscribeInfo(
            env,
            {
                userId: 'user-2',
                topic: 'chat:chat-1',
                prefix: 'chat',
                identifier: 'chat-1',
            },
            async () => sql,
        );

        expect(result).toEqual({ allowed: false });
    });

    it('preserves the intake ownership rule', async () => {
        const sql = makeSql([{ '?column?': 1 }]);

        const result = await getTopicSubscribeInfo(
            env,
            {
                userId: 'user-1',
                topic: 'intake:intake-1',
                prefix: 'intake',
                identifier: 'intake-1',
            },
            async () => sql,
        );

        expect(result).toEqual({ allowed: true });
    });

    it('fails closed on malformed topic without querying SQL', async () => {
        const sql = makeSql([{ selected_model: 'sonnet' }]);

        const result = await getTopicSubscribeInfo(
            env,
            {
                userId: 'user-1',
                topic: 'chat:other-chat',
                prefix: 'chat',
                identifier: 'chat-1',
            },
            async () => sql,
        );

        expect(result).toEqual({ allowed: false });
        expect(sql).not.toHaveBeenCalled();
    });

    it('fails closed on DB error', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await getTopicSubscribeInfo(
            env,
            {
                userId: 'user-1',
                topic: 'chat:chat-1',
                prefix: 'chat',
                identifier: 'chat-1',
            },
            async () => {
                throw new Error('database unavailable');
            },
        );

        expect(result).toEqual({ allowed: false });
        consoleError.mockRestore();
    });

    it('exposes subscribe info through the ChatServices entrypoint with its bound env', async () => {
        const entryEnv = { WORKER_NAME_FULL: 'hi-services-test' } as ServicesEnv;
        const sql = makeSql([{ selected_model: 'sonnet', completion_brief_status: null }]);
        vi.mocked(createNeonSql).mockResolvedValueOnce(sql as unknown as Awaited<ReturnType<typeof createNeonSql>>);

        const entrypoint = new ChatServices({} as ExecutionContext, entryEnv);
        const req = {
            userId: 'user-1',
            topic: 'chat:chat-1',
            prefix: 'chat',
            identifier: 'chat-1',
            previewAlias: 'branch-a',
        };

        await expect(entrypoint.getTopicSubscribeInfo(req)).resolves.toEqual({
            allowed: true,
            selectedModel: 'sonnet',
            completionBriefStatus: null,
        });
        expect(createNeonSql).toHaveBeenCalledWith(entryEnv, 'branch-a');
        expect(sql).toHaveBeenCalledTimes(1);
    });
});
