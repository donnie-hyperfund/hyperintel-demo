// Re-export StreamBlock from common for use in chat module
export type { StreamBlock } from '@/common/ai/agent/types';

import type { StreamBlock } from '@/common/ai/agent/types';

// =============================================================================
// Chat Types
// =============================================================================

export type MessageArtifactRef = {
    id: string;
    identifier: string;
    title: string;
};

/** Message using blocks-based structure for rich content */
export type Message = {
    id: string;
    role: 'user' | 'assistant';
    blocks: StreamBlock[];
    isStreaming?: boolean;
    status?: string;
    createdAt?: Date;
};

export type Conversation = {
    id: string;
    messages: Message[];
    createdAt: Date;
    updatedAt: Date;
};

export type ChatState = {
    messages: Message[];
    isGenerating: boolean;
    error: Error | null;
    streamingMessageId: string | null;
};

// =============================================================================
// Artifact Types
// =============================================================================

export type ArtifactType = 'text/markdown';

export type Artifact = {
    id: string;
    identifier: string;
    title: string;
    type: ArtifactType;
    content: string;
    messageId: string;
};

export type ArtifactMetadata = {
    identifier: string;
    title: string;
    type: ArtifactType;
    language?: string;
};

// =============================================================================
// Streaming Types
// =============================================================================

export type StreamEventType =
    | 'delta'
    | 'created'
    | 'reasoning_start'
    | 'reasoning_delta'
    | 'reasoning_done'
    | 'tool_start'
    | 'tool_result'
    | 'document_start'
    | 'document_delta'
    | 'document_edit'
    | 'document_complete'
    | 'status_update'
    | 'error'
    | 'done'
    | 'done_ext';

export type DocumentEdit = {
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
};

export type StreamEvent =
    // Text content
    | { type: 'delta'; text: string; blockId?: string }
    | { type: 'created'; id: string }
    // Reasoning/thinking
    | { type: 'reasoning_start'; blockId?: string }
    | { type: 'reasoning_delta'; text?: string; content?: string }
    | { type: 'reasoning_done'; durationMs?: number }
    // Tool calls
    | { type: 'tool_start'; id: string; tool: string }
    | { type: 'tool_result'; id: string; result: unknown; success: boolean }
    // Documents/artifacts
    | { type: 'document_start'; name: string; title?: string; pendingVersion: number }
    | { type: 'document_delta'; name: string; pendingVersion: number; content: string }
    | { type: 'document_edit'; name: string; pendingVersion: number; edits: DocumentEdit[] }
    | { type: 'document_complete'; name: string; version: number }
    // Status & control
    | { type: 'status_update'; status: string }
    | { type: 'error'; error: string }
    | { type: 'done' }
    | { type: 'done_ext' };

export type StreamState = {
    isStreaming: boolean;
    error: Error | null;
};

export type StreamSubscriber = (event: StreamEvent) => void;

// =============================================================================
// SSE Parsing Types (for stream-parser service)
// =============================================================================

export type SSEMessage = {
    event?: string;
    data: string;
    id?: string;
    retry?: number;
};

export type ParsedSSEChunk = {
    messages: SSEMessage[];
    remainder: string;
};
