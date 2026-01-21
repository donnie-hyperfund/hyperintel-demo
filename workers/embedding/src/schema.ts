/**
 * Embedding Queue Message Schema
 * 
 * Defines the structure of messages sent to the embedding queue.
 */

import { z } from 'zod';

/**
 * Message sent to the embedding queue when a document is created/updated.
 */
export const EmbeddingQueueMessageSchema = z.object({
    /** Type of operation */
    type: z.literal('index_artifact_version'),
    /** Project ID for the document */
    projectId: z.string().uuid(),
    /** Artifact version ID to index */
    versionId: z.string().uuid(),
    /** Document content to index */
    content: z.string(),
    /** Optional: document name for logging */
    documentName: z.string().optional(),
});

export type EmbeddingQueueMessage = z.infer<typeof EmbeddingQueueMessageSchema>;

/**
 * Batch message for reindexing entire project.
 */
export const ReindexProjectMessageSchema = z.object({
    type: z.literal('reindex_project'),
    projectId: z.string().uuid(),
});

export type ReindexProjectMessage = z.infer<typeof ReindexProjectMessageSchema>;

/**
 * Union of all queue message types.
 */
export const QueueMessageSchema = z.discriminatedUnion('type', [
    EmbeddingQueueMessageSchema,
    ReindexProjectMessageSchema,
]);

export type QueueMessage = z.infer<typeof QueueMessageSchema>;
