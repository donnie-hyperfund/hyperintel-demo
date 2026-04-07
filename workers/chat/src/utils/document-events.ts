/**
 * Document event handling for frontend streaming.
 *
 * Handles the new multi-call document tools:
 * - begin_document → document_start
 * - write_document → document_delta (streamed) + document_progress
 * - patch_document → document_edit
 * - finalize_document → document_complete
 */

import { createStreamFieldParser } from '@common/ai/agent';
import type { AgentStreamEvent } from '@common/ai/agent/types';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DOCUMENT_CHAR_ESTIMATES, type DocumentType } from '@/lib/schema/artifact';

export type DocumentEventEmitter = (event: DocumentEvent) => void;

/** Edit operation as sent by patch_document tool */
export interface EditOperation {
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
}

export type DocumentEvent =
    | {
          type: 'document_start';
          name: string;
          title: string;
          mode: 'create' | 'edit';
          isInternal: boolean;
          pendingVersion: number;
          documentType?: string;
          estimatedChars?: number;
          loadedFrom?: 'proposed' | 'rejected' | 'approved';
          loadedVersion?: number;
          rejectionReason?: string;
      }
    | { type: 'document_delta'; name: string; content: string }
    | { type: 'document_progress'; name: string; progress: number }
    | {
          type: 'document_edit';
          name: string;
          edits: EditOperation[];
          editsApplied: number;
          linesNow: number;
      }
    | {
          type: 'document_complete';
          name: string;
          version: number;
          lines: number;
          action: string;
          status: 'proposed';
          supersededVersion?: number;
      };

export interface DocumentContext {
    em: EntityManager;
    projectId?: string;
}

/**
 * Creates a document event handler for the new multi-call document tools.
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
    let activeDoc: { name: string; title: string; isInternal: boolean; isPECP?: boolean; parentDocument?: string } | null = null;

    // Parser for write_document content streaming
    let writeParser: ReturnType<typeof createStreamFieldParser> | null = null;

    // Accumulator for patch_document input (to capture the edits array)
    let editBuffer = '';

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
                name: activeDoc.name,
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
                if (!event.success) {
                    editBuffer = '';
                    return;
                }

                let result: any = null;
                try {
                    result = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
                } catch {
                    editBuffer = '';
                    return;
                }
                if (!result) {
                    editBuffer = '';
                    return;
                }

                // begin_document: set active doc and emit document_start (or pecp_start for PECP)
                if (result.status === 'editing' && result.name) {
                    activeDoc = {
                        name: result.name,
                        title: result.title || result.name,
                        isInternal: result.is_internal ?? true,
                        isPECP: result.isPECP ?? false,
                        parentDocument: result.parentDocument,
                    };

                    // Reset progress tracking
                    accumulatedChars = 0;
                    lastEmittedProgress = 0;
                    const docType = result.document_type as DocumentType | undefined;
                    estimatedChars = docType
                        ? (DOCUMENT_CHAR_ESTIMATES[docType] ?? DOCUMENT_CHAR_ESTIMATES.Other)
                        : DOCUMENT_CHAR_ESTIMATES.Other;

                    // PECP: emit pecp_start with parent document name instead of document_start
                    if (activeDoc.isPECP && activeDoc.parentDocument) {
                        emit({
                            type: 'pecp_start',
                            parentDocument: activeDoc.parentDocument,
                        } as any);
                    } else {
                        const pendingVersion = result.loadedVersion ? result.loadedVersion + 1 : 1;

                        const startEvent: DocumentEvent = {
                            type: 'document_start',
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

                        // Add edit-mode specific fields
                        if (result.loadedFrom) {
                            startEvent.loadedFrom = result.loadedFrom;
                        }
                        if (result.loadedVersion !== undefined) {
                            startEvent.loadedVersion = result.loadedVersion;
                        }
                        if (result.rejectionReason) {
                            startEvent.rejectionReason = result.rejectionReason;
                        }

                        emit(startEvent);
                    }
                }

                // patch_document: emit document_edit with the captured edits
                if (result.status === 'edited' && activeDoc) {
                    // Parse the accumulated input to get the edits array
                    let edits: EditOperation[] = [];
                    try {
                        const parsed = JSON.parse(editBuffer);
                        if (Array.isArray(parsed.edits)) {
                            edits = parsed.edits;
                        }
                    } catch {
                        // Fallback: empty edits if parsing failed
                    }

                    if (!activeDoc.isInternal) {
                        emit({
                            type: 'document_edit',
                            name: activeDoc.name,
                            edits,
                            editsApplied: result.editsApplied ?? edits.length,
                            linesNow: result.linesNow ?? 0,
                        });
                    }
                    editBuffer = '';
                }

                // finalize_document: emit document_complete (or pecp_complete) and clear state
                if (result.version !== undefined && result.lines !== undefined) {
                    if (result.isPECP && activeDoc?.parentDocument) {
                        // PECP: emit pecp_complete with parent document name
                        emit({
                            type: 'pecp_complete',
                            parentDocument: activeDoc.parentDocument,
                        } as any);
                    } else {
                        const name = result.name || activeDoc?.name;
                        if (name) {
                            const completeEvent: DocumentEvent = {
                                type: 'document_complete',
                                name,
                                version: result.version,
                                lines: result.lines,
                                action: result.action || 'created',
                                status: 'proposed',
                            };

                            if (result.supersededVersion !== undefined) {
                                completeEvent.supersededVersion = result.supersededVersion;
                            }

                            emit(completeEvent);
                        }
                    }
                    activeDoc = null;
                    writeParser = null;
                    editBuffer = '';
                    accumulatedChars = 0;
                    estimatedChars = 0;
                    lastEmittedProgress = 0;
                }
                break;
            }

            case 'tool_call_delta': {
                // write_document: stream the content field
                if (event.tool === 'write_document' && activeDoc) {
                    if (!writeParser) {
                        writeParser = createStreamFieldParser({
                            toolName: 'write_document',
                            field: 'content',
                            onDelta: (delta) => {
                                if (!activeDoc) return;

                                // Track chars for progress (always, even for internal docs)
                                accumulatedChars += delta.length;

                                // PECP: emit pecp_delta with parent document name
                                if (activeDoc.isPECP && activeDoc.parentDocument) {
                                    emit({
                                        type: 'pecp_delta',
                                        parentDocument: activeDoc.parentDocument,
                                        content: delta,
                                    } as any);
                                } else {
                                    maybeEmitProgress();

                                    // Only emit content deltas for non-internal docs
                                    if (!activeDoc.isInternal) {
                                        emit({
                                            type: 'document_delta',
                                            name: activeDoc.name,
                                            content: delta,
                                        });
                                    }
                                }
                            },
                        });
                    }
                    writeParser.feed(event);
                }

                // patch_document: accumulate args to capture the edits array
                if (event.tool === 'patch_document') {
                    editBuffer += event.delta;
                }
                break;
            }

            case 'tool_start': {
                // Reset parser when a new write_document starts
                if (event.tool === 'write_document') {
                    writeParser = null;
                }
                // Reset edit state on new patch_document
                if (event.tool === 'patch_document') {
                    editBuffer = '';
                }
                break;
            }

            default:
                break;
        }
    }

    return { handle };
}
