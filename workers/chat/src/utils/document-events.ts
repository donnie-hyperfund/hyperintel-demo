/**
 * Document event handling for frontend streaming.
 *
 * Handles the multi-call document tools:
 * - begin_document → document_start
 * - write_document → document_delta (streamed) + document_progress
 * - patch_document → document_edit
 * - finalize_document → document_complete
 *
 * The PECP / internal-document summary is a separate concern handled by the
 * pecp-generator (which pushes its own `summary_*` events directly).
 */

import { createStreamFieldParser } from '@common/ai/agent';
import type { AgentStreamEvent } from '@common/ai/agent/types';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DOCUMENT_CHAR_ESTIMATES, type DocumentType } from '@/lib/schema/artifact';
import type { AppliedEdit, DraftManager } from '../tools/documents';

export type DocumentEventEmitter = (event: DocumentEvent) => void;

type EmittedEdit = AppliedEdit;

export type DocumentEvent =
    | {
          type: 'document_start';
          artifactId: string;
          name: string;
          title: string;
          mode: 'create' | 'edit' | 'replace';
          isInternal: boolean;
          pendingVersion: number;
          documentType?: DocumentType;
          estimatedChars?: number;
          loadedFrom?: 'proposed' | 'rejected' | 'approved';
          loadedVersion?: number;
          nextVersion?: number;
          rejectionReason?: string;
          loadedContent?: string;
      }
    | { type: 'document_delta'; artifactId: string; name: string; pendingVersion: number; content: string }
    | { type: 'document_progress'; artifactId: string; name: string; pendingVersion: number; progress: number }
    | {
          type: 'document_edit';
          artifactId: string;
          name: string;
          pendingVersion: number;
          edits: EmittedEdit[];
          editsApplied: number;
          linesNow: number;
      }
    | {
          type: 'document_complete';
          artifactId: string;
          name: string;
          version?: number;
          lines: number;
          action: string;
          status: 'proposed' | 'superseded' | 'aborted';
          supersededVersion?: number;
          supersededByVersion?: number;
          summaryPending?: boolean;
      };

export interface DocumentContext {
    em: EntityManager;
    projectId?: string;
    /** Required for patch_document replay — canonical edits are stashed here by the executor and consumed on tool_result. */
    draftManager?: DraftManager;
}

/**
 * Creates a document event handler for the multi-call document tools.
 *
 * Flow:
 * 1. begin_document result → emit document_start
 * 2. write_document deltas → emit document_delta + document_progress
 * 3. patch_document result → emit document_edit
 * 4. finalize_document result → emit document_complete
 *
 * Since tools stream sequentially, we can use a simple "current document" state.
 */
export function createDocumentEventHandler(ctx: DocumentContext, emit: DocumentEventEmitter) {
    // Current document being written (set by begin_document, cleared by finalize_document)
    let activeDoc: {
        artifactId: string;
        name: string;
        title: string;
        isInternal: boolean;
        pendingVersion: number;
    } | null = null;

    // Parser for write_document content streaming
    let writeParser: ReturnType<typeof createStreamFieldParser> | null = null;

    // Progress tracking state
    let accumulatedChars = 0;
    let estimatedChars = 0;
    let lastEmittedProgress = 0;

    /**
     * Calculate and emit progress if the change is significant enough.
     * Progress is capped at 99 during streaming — 100 is implied by document_complete.
     */
    function maybeEmitProgress(): void {
        if (!activeDoc || estimatedChars <= 0) return;

        const rawProgress = Math.min(Math.floor((accumulatedChars / estimatedChars) * 100), 99);
        if (rawProgress !== lastEmittedProgress) {
            lastEmittedProgress = rawProgress;
            console.log(
                `[doc-progress] ${activeDoc.name}: ${rawProgress}% (${accumulatedChars}/${estimatedChars} chars)`,
            );
            emit({
                type: 'document_progress',
                artifactId: activeDoc.artifactId,
                name: activeDoc.name,
                pendingVersion: activeDoc.pendingVersion,
                progress: rawProgress,
            });
        }
    }

    /**
     * Process an agent stream event and emit document events as appropriate.
     */
    function handle(event: AgentStreamEvent): void {
        switch (event.type) {
            case 'tool_result': {
                if (!event.success) return;

                let result: any = null;
                try {
                    result = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
                } catch {
                    return;
                }
                if (!result) return;

                // begin_document: set active doc and emit document_start
                if (result.status === 'editing' && result.name) {
                    if (typeof result.artifactId !== 'string') return;
                    const pendingVersion = result.nextVersion ?? (result.loadedVersion ? result.loadedVersion + 1 : 1);

                    activeDoc = {
                        artifactId: result.artifactId,
                        name: result.name,
                        title: result.title || result.name,
                        isInternal: result.is_internal ?? true,
                        pendingVersion,
                    };

                    // Reset progress tracking
                    accumulatedChars = 0;
                    lastEmittedProgress = 0;
                    const docType = result.document_type as DocumentType | undefined;
                    estimatedChars = docType
                        ? (DOCUMENT_CHAR_ESTIMATES[docType] ?? DOCUMENT_CHAR_ESTIMATES.Other)
                        : DOCUMENT_CHAR_ESTIMATES.Other;

                    const startEvent: DocumentEvent = {
                        type: 'document_start',
                        artifactId: activeDoc.artifactId,
                        name: activeDoc.name,
                        title: activeDoc.title,
                        mode: result.mode || 'create',
                        isInternal: activeDoc.isInternal,
                        pendingVersion,
                        estimatedChars,
                    };

                    if (result.document_type) {
                        startEvent.documentType = result.document_type;
                    }
                    if (result.loadedFrom) {
                        startEvent.loadedFrom = result.loadedFrom;
                    }
                    if (result.loadedVersion !== undefined) {
                        startEvent.loadedVersion = result.loadedVersion;
                    }
                    if (result.nextVersion !== undefined) {
                        startEvent.nextVersion = result.nextVersion;
                    }
                    if (result.rejectionReason) {
                        startEvent.rejectionReason = result.rejectionReason;
                    }

                    // For non-internal edit-mode starts, include the loaded base content so the DO snapshot can replay subsequent edits correctly on reconnect. Skipped for internal docs (would store internal content in DO state) and for create/replace (draft starts empty anyway).
                    if (!activeDoc.isInternal && startEvent.mode === 'edit') {
                        const loaded = ctx.draftManager?.getCurrent()?.content;
                        if (typeof loaded === 'string') {
                            startEvent.loadedContent = loaded;
                        }
                    }

                    emit(startEvent);
                }

                // patch_document: canonical edits live on draftManager side channel (keyed by tool_call_id)
                if (event.tool === 'patch_document' && result.status === 'edited' && activeDoc) {
                    const edits: EmittedEdit[] = event.id ? (ctx.draftManager?.takeAppliedEdits(event.id) ?? []) : [];

                    if (!activeDoc.isInternal && edits.length) {
                        emit({
                            type: 'document_edit',
                            artifactId: activeDoc.artifactId,
                            name: activeDoc.name,
                            pendingVersion: activeDoc.pendingVersion,
                            edits,
                            editsApplied: result.editsApplied ?? edits.length,
                            linesNow: result.linesNow ?? 0,
                        });
                    }
                }

                // finalize_document: emit document_complete and clear state
                if (result.action === 'aborted' && result.lines !== undefined) {
                    const name = result.name || activeDoc?.name;
                    const artifactId = result.artifactId ?? activeDoc?.artifactId;
                    if (name && artifactId) {
                        emit({
                            type: 'document_complete',
                            artifactId,
                            name,
                            lines: result.lines,
                            action: 'aborted',
                            status: 'aborted',
                        });
                    }
                    activeDoc = null;
                    writeParser = null;
                    accumulatedChars = 0;
                    estimatedChars = 0;
                    lastEmittedProgress = 0;
                } else if (result.version !== undefined && result.lines !== undefined) {
                    const name = result.name || activeDoc?.name;
                    const artifactId = result.artifactId ?? activeDoc?.artifactId;
                    if (name && artifactId) {
                        const completeEvent: DocumentEvent = {
                            type: 'document_complete',
                            artifactId,
                            name,
                            version: result.version,
                            lines: result.lines,
                            action: result.action || 'created',
                            status: result.status ?? 'proposed',
                        };

                        if (result.supersededVersion !== undefined) {
                            completeEvent.supersededVersion = result.supersededVersion;
                        }
                        if (result.supersededByVersion !== undefined) {
                            completeEvent.supersededByVersion = result.supersededByVersion;
                        }
                        if (result.summaryPending) {
                            completeEvent.summaryPending = true;
                        }

                        emit(completeEvent);
                    }
                    activeDoc = null;
                    writeParser = null;
                    accumulatedChars = 0;
                    estimatedChars = 0;
                    lastEmittedProgress = 0;
                }
                break;
            }

            case 'tool_call_delta': {
                // write_document: stream the content field. Replacement semantics are known from begin_document(mode="replace").
                if (event.tool === 'write_document' && activeDoc) {
                    if (!writeParser) {
                        writeParser = createStreamFieldParser({
                            toolName: 'write_document',
                            field: 'content',
                            onDelta: (delta) => {
                                if (!activeDoc) return;

                                accumulatedChars += delta.length;
                                maybeEmitProgress();

                                // Only emit content deltas for non-internal docs
                                if (!activeDoc.isInternal) {
                                    emit({
                                        type: 'document_delta',
                                        artifactId: activeDoc.artifactId,
                                        name: activeDoc.name,
                                        pendingVersion: activeDoc.pendingVersion,
                                        content: delta,
                                    });
                                }
                            },
                        });
                    }
                    writeParser.feed(event);
                }
                break;
            }

            case 'tool_start': {
                // Reset parser when a new write_document starts
                if (event.tool === 'write_document') {
                    writeParser = null;
                }
                break;
            }

            default:
                break;
        }
    }

    return { handle };
}
