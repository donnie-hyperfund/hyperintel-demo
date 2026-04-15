import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
    frontendEnv: {
        NEXT_PUBLIC_LOCAL_WORKERS: true,
        NEXT_PUBLIC_CLOUDFLARE_BASE: '',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
    },
}));

vi.mock('@/lib/vendor/r2', () => ({
    createWorkerS3Client: vi.fn(async () => ({ stub: true })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn(async () => 'https://signed.example/upload'),
}));

import { ChatMessageFileEntity } from '@/lib/orm/entities/chats/chat-message-file.entity';
import { associateImagesInternal } from './image-uploader';

const DB_USER_ID = '11111111-1111-1111-1111-111111111111';
const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const FILE_A = '33333333-3333-3333-3333-333333333333';
const FILE_B = '44444444-4444-4444-4444-444444444444';

describe('associateImagesInternal', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sets chat_id on matching staged files and returns the count', async () => {
        const files = [
            { id: FILE_A, chat_id: null, storage_key: `chat-images/staged/${DB_USER_ID}/a.png` },
            { id: FILE_B, chat_id: null, storage_key: `chat-images/staged/${DB_USER_ID}/b.png` },
        ];

        let lastQuery: any = null;
        const em = {
            find: vi.fn(async (entity: unknown, query: any) => {
                lastQuery = query;
                if (entity === ChatMessageFileEntity) return files;
                return [];
            }),
            flush: vi.fn(),
        } as any;

        const n = await associateImagesInternal(em, DB_USER_ID, CHAT_ID, [FILE_A, FILE_B]);

        expect(n).toBe(2);
        expect(files[0].chat_id).toBe(CHAT_ID);
        expect(files[1].chat_id).toBe(CHAT_ID);
        expect(em.flush).toHaveBeenCalledOnce();

        // The query must scope to staged prefix for THIS user — that's the ownership gate.
        expect(lastQuery.chat_id).toBeNull();
        expect(lastQuery.storage_key.$like).toBe(`chat-images/staged/${DB_USER_ID}/%`);
        expect(lastQuery.id.$in).toEqual([FILE_A, FILE_B]);
    });

    it('returns 0 and skips flush when the id list is empty', async () => {
        const em = { find: vi.fn(), flush: vi.fn() } as any;
        const n = await associateImagesInternal(em, DB_USER_ID, CHAT_ID, []);
        expect(n).toBe(0);
        expect(em.find).not.toHaveBeenCalled();
        expect(em.flush).not.toHaveBeenCalled();
    });

    it('returns 0 when no files match — e.g. ids belong to a different user (ownership safety)', async () => {
        const em = {
            find: vi.fn(async () => []),
            flush: vi.fn(),
        } as any;

        const n = await associateImagesInternal(em, DB_USER_ID, CHAT_ID, [FILE_A]);
        expect(n).toBe(0);
        expect(em.flush).not.toHaveBeenCalled();
    });
});
