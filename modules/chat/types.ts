// Re-export StreamBlock from common for use in chat module
export type { StreamBlock } from '@/common/ai/agent/types';

import type { StreamBlock } from '@/common/ai/agent/types';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ArtifactDto } from '@/lib/schema/artifact';
import type { TokenUsage } from '@/lib/schema/stream';

// =============================================================================
// Chat Types
// =============================================================================

export type ChatType = 'phase' | 'company' | 'stakeholder';

export type SummaryStatus = 'generating-summary' | 'finalizing';

export type MessageArtifactRef = {
    id: string;
    identifier: string;
    title: string;
};

export type MessageMetadata = {
    preset?: string;
    error?: string;
    errorCode?: string;
    requestId?: string;
    inference?: {
        paramsType?: string;
        model?: string;
        [key: string]: unknown;
    };
    usage?: {
        inputTokens: number;
        outputTokens: number;
        reasoningTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cacheWrite1hTokens?: number;
        cost?: number;
        costWarnings?: string[];
        cacheCost?: {
            readCost?: number;
            readSaved?: number;
            writeCost?: number;
            write1hCost?: number;
        };
        segments: Array<{
            inputTokens: number;
            outputTokens: number;
            reasoningTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
            cacheWrite1hTokens?: number;
            cost?: number;
            toolCalls?: Array<{
                toolName: string;
                argumentTokens?: number;
                resultTokens?: number;
                /** @deprecated compat only — older rows; use `argumentTokens` */
                inputTokens?: number;
                /** @deprecated compat only — older rows; use `resultTokens` */
                outputTokens?: number;
                usageLabel?: string;
            }>;
        }>;
        providerIds: string[];
    };
    [key: string]: unknown;
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
        reason?: string;
    };
    status?: string;
    createdAt?: Date;
    feedbackScore?: boolean | null;
    feedbackComment?: string | null;
    metadata?: MessageMetadata | null;
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
    totalCost: number | null;
    hasPendingChanges: boolean;
    phaseIndex: number | null;
    /** Chat ID of the new phase after summarization completes */
    summaryNewChatId: string | null;
    /** True when AI triggered generate_summary from chat — tells UI to show the phase transition dialog */
    pendingPhaseTransition: boolean;
    /** Active agent message ID for WS-based abort */
    activeResponseId: string | null;
    /** Current summarizer status (e.g. "generating-summary", "finalizing") */
    summaryStatus: SummaryStatus | null;
    /** True while an artifact approval/rejection API call is in flight */
    isProcessingArtifactAction: boolean;
    /** True when the user tried to send with an unavailable model — shows an alert dialog */
    showInvalidModelAlert: boolean;
    /** Completion Brief approval status for the current phase chat */
    completionBriefStatus: string | null;
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

export type Artifact = Partial<CamelCaseDto<ArtifactDto>> & {
    id: string;
    key: string;
    title: string;
    isLoading?: boolean;
    isStreaming?: boolean;
    isUpdating?: boolean;
    progress?: number;
    pecpContent?: string;
};

// =============================================================================
// Token Usage & Streaming Types (canonical definitions in lib/schema/stream)
// =============================================================================

export type { DocumentEdit, StreamEvent, StreamEventType, TokenBreakdown, TokenUsage } from '@/lib/schema/stream';
