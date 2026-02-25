// Re-export StreamBlock from common for use in chat module
export type { StreamBlock } from '@/common/ai/agent/types';

import type { StreamBlock } from '@/common/ai/agent/types';
import type { ArtifactDto } from '@/lib/schema/artifact';

// =============================================================================
// Chat Types
// =============================================================================

export type ChatType = 'phase' | 'company' | 'stakeholder';

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
    isError?: boolean;
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
    isSummarizing: boolean;
    isLoading: boolean;
    error: Error | null;
    streamingMessageId: string | null;
    tokenUsage: TokenUsage | null;
    hasPendingChanges: boolean;
    phaseIndex: number | null;
    /** Chat ID of the new phase after summarization completes */
    summaryNewChatId: string | null;
    /** True when AI triggered generate_summary from chat — tells UI to show the phase transition dialog */
    pendingPhaseTransition: boolean;
};

export type PaginationState = {
    page: number;
    totalPages: number;
    isLoadingMore: boolean;
    hasMore: boolean;
};

// =============================================================================
// Artifact Types
// =============================================================================

export type Artifact = Partial<ArtifactDto> & {
    id: string;
    key: string;
    title: string;
    isLoading?: boolean;
    isStreaming?: boolean;
    isUpdating?: boolean;
};

// =============================================================================
// Token Usage Types
// =============================================================================

export type TokenBreakdown = {
    context: number;
    prompt: number;
    promptTool: number;
    toolDef: number;
};

export type TokenUsage = {
    usedTokens: number;
    tokenBreakdown: TokenBreakdown;
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
    | 'search_start'
    | 'search_results'
    | 'citation'
    | 'document_start'
    | 'document_delta'
    | 'document_patch'
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
    // Search & citations
    | { type: 'search_start'; query: string; blockId: string }
    | { type: 'search_results'; blockId: string; resultCount: number }
    | {
          type: 'citation';
          url: string;
          citedText: string;
          title?: string;
          blockId: string;
          parentTextBlockId: string;
          startIndex: number;
          endIndex: number;
      }
    // Documents/artifacts
    | { type: 'document_start'; name: string; title?: string; pendingVersion: number }
    | { type: 'document_delta'; name: string; pendingVersion: number; content: string }
    | { type: 'document_edit'; name: string; pendingVersion: number; edits: DocumentEdit[] }
    | { type: 'document_complete'; name: string; version: number }
    // Status & control
    | { type: 'status_update'; status: string }
    | { type: 'error'; error: string; soft?: boolean }
    | { type: 'done'; tokenUsage?: TokenUsage; error?: string }
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
