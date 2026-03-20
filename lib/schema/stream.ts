import type { StreamBlock } from '@/common/ai/agent/types';

// Re-export StreamBlock for convenience
export type { StreamBlock } from '@/common/ai/agent/types';

// ============================================================================
// TOKEN USAGE (canonical definitions in chat.ts via Zod schemas)
// ============================================================================

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

export type StreamStatus = 'streaming' | 'done' | 'aborted' | 'error' | 'pending_approval';

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
          name: string;
          title?: string;
          pendingVersion: number;
          mode?: 'create' | 'edit';
          loadedVersion?: number;
          /** document_type from begin_document tool result */
          documentType?: string;
          loadedFrom?: 'proposed' | 'rejected' | 'approved';
          rejectionReason?: string;
          isInternal?: boolean;
      }
    | { type: 'document_delta'; name: string; pendingVersion?: number; content: string }
    | { type: 'document_edit'; name: string; pendingVersion?: number; edits: DocumentEdit[] }
    | { type: 'document_complete'; name: string; version: number; lines?: number; action?: string }
    // Status & control
    | { type: 'status_update'; status: string }
    | { type: 'error'; error: string; soft?: boolean }
    | {
          type: 'done';
          tokenUsage?: TokenUsage;
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
    name: string;
    title: string;
    mode: 'create' | 'edit';
    pendingVersion: number;
    loadedVersion?: number;
    content: string;
};

/** Full state snapshot returned on subscribe */
export type StreamSnapshot = {
    blocks: StreamBlock[];
    activeDocuments: ActiveDocument[];
    status: StreamStatus;
};
