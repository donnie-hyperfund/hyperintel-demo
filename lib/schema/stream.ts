import type { StreamBlock } from '@/common/ai/agent/types';

// Re-export StreamBlock for convenience
export type { StreamBlock } from '@/common/ai/agent/types';

// ============================================================================
// TOKEN USAGE (canonical definitions in chat.ts via Zod schemas)
// ============================================================================

import type { DocumentType } from './artifact';
import type { TokenBreakdown, TokenUsage } from './chat';

export type { TokenBreakdown, TokenUsage };

// ============================================================================
// STREAM EVENT
// ============================================================================

/** Edit operation for document patches (line-based) */
export interface DocumentEdit {
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
}

/** One choice offered to the user by a decision_prompt. */
export interface DecisionOption {
    /** Machine value returned to the agent when the user picks this option. */
    value: string;
    /** Human-readable button label shown in the UI. */
    label: string;
    /** Optional longer description rendered under the button. */
    description?: string;
}

/** A pending user-decision card currently awaiting the user's click. */
export interface PendingDecision {
    toolCallId: string;
    question: string;
    options: DecisionOption[];
    /** Optional extra context to show to the user above the options (no tool output / prompt leakage). */
    context?: string;
}

/**
 * Result of a resolved decision prompt.
 * - Option click: `value` is the chosen option, `freeText` is undefined.
 * - "Other" (free-text) path: `freeText` is the typed answer and `value` is the UI sentinel (e.g. `__other__`).
 */
export interface DecisionResult {
    value: string;
    freeText?: string;
}

/** Sentinel `value` the UI sends on the Other/free-text path. */
export const DECISION_OTHER_SENTINEL = '__other__';
/** Sentinel `value` the backend broadcasts on `decision_resolved` when the user dismissed without picking. */
export const DECISION_DISMISSED_SENTINEL = '__dismissed__';

export type StreamStatus = 'streaming' | 'done' | 'aborted' | 'error' | 'pending_approval';

export type StreamEventType =
    | 'delta'
    | 'created'
    | 'reasoning_start'
    | 'reasoning_delta'
    | 'reasoning_done'
    | 'tool_start'
    | 'tool_call_complete'
    | 'tool_result'
    | 'search_start'
    | 'search_results'
    | 'citation'
    | 'document_start'
    | 'document_delta'
    | 'document_patch'
    | 'document_edit'
    | 'document_progress'
    | 'document_complete'
    | 'summary_start'
    | 'summary_delta'
    | 'summary_complete'
    | 'decision_prompt'
    | 'decision_resolved'
    | 'status_update'
    | 'error'
    | 'done'
    | 'done_ext'
    | 'safety_retract';

/**
 * StreamEvent — discriminated union of all streaming events.
 *
 * Used by: Worker → ChatStream DO push, DO → subscriber broadcast, frontend useStream.
 * The Worker forwards these directly to the DO — no translation layer.
 */
export type StreamEvent =
    // Text content
    | { type: 'delta'; text: string; blockId?: string }
    | { type: 'created'; id: string }
    // Reasoning/thinking
    | { type: 'reasoning_start'; blockId?: string }
    | { type: 'reasoning_delta'; text?: string; content?: string; blockId?: string }
    | { type: 'reasoning_done'; durationMs?: number; blockId?: string }
    // Tool calls
    | { type: 'tool_start'; id: string; tool: string }
    | { type: 'tool_call_complete'; id: string; tool: string; input: Record<string, unknown> | string }
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
    | {
          type: 'document_start';
          /** Persisted ArtifactEntity id. */
          artifactId: string;
          name: string;
          title?: string;
          pendingVersion: number;
          mode?: 'create' | 'edit' | 'replace';
          loadedVersion?: number;
          /** Authoritative next version slot from backend (artifact.latestVersion + 1). FE prefers this over loadedVersion + 1 to avoid collisions when user is viewing an older version via version-history. */
          nextVersion?: number;
          /** document_type from begin_document tool result */
          documentType?: DocumentType;
          /** Estimated content size in characters for progress tracking */
          estimatedChars?: number;
          loadedFrom?: 'proposed' | 'rejected' | 'approved';
          rejectionReason?: string;
          isInternal?: boolean;
          /** Base content of the loaded version for non-internal edit-mode starts. DO uses this to seed activeDocuments[].content so reconnect snapshots can replay subsequent edits correctly. Omitted for internal docs and for create/replace modes. */
          loadedContent?: string;
      }
    | {
          type: 'document_delta';
          artifactId: string;
          name: string;
          pendingVersion: number;
          content: string;
      }
    | { type: 'document_edit'; artifactId: string; name: string; pendingVersion: number; edits: DocumentEdit[] }
    | { type: 'document_progress'; artifactId: string; name: string; pendingVersion: number; progress: number }
    | {
          type: 'document_complete';
          artifactId: string;
          name: string;
          version?: number;
          lines?: number;
          action?: string;
          status?: 'proposed' | 'superseded' | 'aborted';
          supersededVersion?: number;
          supersededByVersion?: number;
          /** Set when finalize_document persisted an internal-document version that will get an auto-generated summary. */
          summaryPending?: boolean;
      }
    // Internal-document PE-facing summaries (auto-generated, streamed alongside the parent doc).
    | {
          type: 'summary_start';
          /** Parent ArtifactEntity id. */
          artifactId: string;
          /** Parent document name (e.g. genesis-dna.md). */
          name: string;
          /** Parent artifact_versions row that this summary will be written to. */
          versionId: string;
          /** Version number of the parent doc — used by the frontend to update the right artifact entry. */
          version: number;
          estimatedChars?: number;
      }
    | {
          type: 'summary_delta';
          artifactId: string;
          name: string;
          versionId: string;
          version: number;
          content: string;
      }
    | {
          type: 'summary_complete';
          artifactId: string;
          name: string;
          versionId: string;
          version: number;
          /** Final assembled summary content — frontend can use this as the source of truth. */
          content: string;
      }
    // User decision prompts
    | {
          type: 'decision_prompt';
          toolCallId: string;
          question: string;
          options: DecisionOption[];
          context?: string;
      }
    | { type: 'decision_resolved'; toolCallId: string; value: string; freeText?: string }
    // Status & control
    | { type: 'status_update'; status: string }
    | { type: 'error'; error: string; soft?: boolean }
    | {
          type: 'done';
          tokenUsage?: TokenUsage;
          totalCost?: number;
          /** Per-message metadata (preset, inference config, usage) — applied to the streaming message on arrival */
          messageMetadata?: Record<string, unknown>;
          error?: string;
          outputType?: 'text' | 'tool';
          outputTool?: string;
          hasPendingChanges?: boolean;
          phaseIndex?: number | null;
          /** Set by summarizer when summary completes — ID of the new continuation chat */
          newChatId?: string;
      }
    | { type: 'done_ext' }
    // Safety
    | { type: 'safety_retract'; reason: string; severity: string; evidence: string | null };

// ============================================================================
// STREAM DO STATE
// ============================================================================

/** Partial document state tracked by Stream DO between document_start and document_complete */
export type ActiveDocument = {
    /** Persisted ArtifactEntity id. */
    artifactId: string;
    name: string;
    title: string;
    mode: 'create' | 'edit' | 'replace';
    pendingVersion: number;
    loadedVersion?: number;
    /** Current draft content — mutates with deltas/edits as they arrive. */
    content: string;
    /** Base content of the loaded version (non-internal edit mode only). Preserved unchanged through the stream so reconnect snapshots can populate currentVersion.content for the diff UI. */
    loadedContent?: string;
    documentType?: DocumentType;
    isInternal?: boolean;
    progress?: number;
    /** When set, an auto-generated summary is streaming in alongside the parent document (after document_complete). */
    summaryInternal?: string;
    /** Identifier of the artifact_versions row the summary is being written to. */
    summaryVersionId?: string;
};

/** Full state snapshot returned on subscribe */
export type StreamSnapshot = {
    blocks: StreamBlock[];
    activeDocuments: ActiveDocument[];
    pendingDecisions: PendingDecision[];
    status: StreamStatus;
    displayStatus?: string | null;
};
