// Re-export StreamBlock from common for use in chat module
export type { StreamBlock } from '@/common/ai/agent/types';

import type { StreamBlock } from '@/common/ai/agent/types';
import type { ArtifactDto } from '@/lib/schema/artifact';
import type { TokenUsage } from '@/lib/schema/stream';

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
    tempId?: string;
    role: 'user' | 'assistant';
    blocks: StreamBlock[];
    isStreaming?: boolean;
    isError?: boolean;
    isAborted?: boolean;
    isRetracted?: boolean;
    /** Synthetic system event injected by the backend (e.g. artifact approved via UI) */
    systemEvent?: {
        type: string;
        artifactKey?: string;
        versionNumber?: number;
        sourceVersionNumber?: number;
        reason?: string;
    };
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
    /** Active agent message ID for WS-based abort */
    activeResponseId: string | null;
    /** Live blocks from the summary stream — available for rendering in the summary modal */
    summaryBlocks: StreamBlock[];
    /** True while an artifact approval/rejection API call is in flight */
    isProcessingArtifactAction: boolean;
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
    progress?: number;
};

// =============================================================================
// Token Usage & Streaming Types (canonical definitions in lib/schema/stream)
// =============================================================================

export type { DocumentEdit, StreamEvent, StreamEventType, TokenBreakdown, TokenUsage } from '@/lib/schema/stream';
