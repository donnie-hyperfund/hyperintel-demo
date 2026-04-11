import type { Queue } from '@cloudflare/workers-types';
import { HttpQueueAdapter, NoopQueueAdapter, QueueAdapter } from '@common/common/queue.adapter';
import { z } from 'zod';
import { getWorkerUrl } from '@/lib/api/requests/worker/common';

export const ExtractionQueueMessageSchema = z.object({
    type: z.literal('extract_file_content'),
    fileId: z.string().uuid(),
    artifactId: z.string().uuid(),
    versionId: z.string().uuid(),
    storageKey: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    projectId: z.string().uuid().nullable().optional(),
    chatId: z.string().uuid().nullable().optional(),
    /** Preview branch alias — when set, the worker connects to the branch DB instead of main */
    previewAlias: z.string().nullish(),
});

export type ExtractionQueueMessage = z.infer<typeof ExtractionQueueMessageSchema>;

export class ExtractionQueueAdapter {
    constructor(private queue: Queue) {}

    async send(message: ExtractionQueueMessage): Promise<void> {
        await this.queue.send(message);
    }
}

/**
 * Helper to create the appropriate extraction queue adapter.
 * Local dev: returns MockQueue from workerEnv (in-process).
 * Deployed: HttpAdapter with inferred worker URL.
 */
export function createExtractionQueueAdapter(): QueueAdapter<ExtractionQueueMessage> {
    if (process.env.NEXT_PUBLIC_LOCAL_WORKERS === 'true') {
        // Dynamic import to avoid pulling local mock deps into production bundle
        const { workerEnv } = require('@/lib/local/cf-env-secret-mock');
        return workerEnv.EXTRACTION_QUEUE as QueueAdapter<ExtractionQueueMessage>;
    }

    const authSecret = process.env.AUTH_SECRET;
    if (authSecret) {
        const endpoint = getWorkerUrl('extraction', '/enqueue');
        return new HttpQueueAdapter<ExtractionQueueMessage>(endpoint, authSecret, 'extraction');
    }

    console.warn('[createExtractionQueueAdapter] AUTH_SECRET not configured');
    return new NoopQueueAdapter<ExtractionQueueMessage>('extraction');
}
