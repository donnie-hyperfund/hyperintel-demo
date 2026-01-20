/**
 * Document event handling for frontend streaming.
 */

import { createStreamFieldParser } from '@common/ai/agent';
import type { AgentStreamEvent } from '@common/ai/agent/types';
import type { EntityManager } from '@mikro-orm/postgresql';
import { OBJ, parse as parsePartial, STR } from 'partial-json';
import { findDocumentByName, normalizeDocumentName } from '../tools/documents';

export type DocumentEventEmitter = (event: DocumentEvent) => void;

export type DocumentEvent =
    | { type: 'document_start'; name: string; title: string; pendingVersion: number }
    | { type: 'document_delta'; name: string; pendingVersion: number; content: string }
    | { type: 'document_complete'; name: string; version: number; lines: number; action: string }
    | { type: 'document_edit'; name: string; editsApplied: number; linesNow: number; version: number };

export interface DocumentContext {
    em: EntityManager;
    projectId: string;
}

/**
 * Creates a document event handler that processes agent stream events
 * and emits document-specific events for the frontend.
 */
export function createDocumentEventHandler(ctx: DocumentContext, emit: DocumentEventEmitter) {
    const parsers = new Map<string, ReturnType<typeof createStreamFieldParser>>();
    const pendingVersions = new Map<string, number>();
    const names = new Map<string, string>();
    const accumulators = new Map<string, string>();

    /**
     * Process an agent stream event and emit document events as appropriate.
     * Returns true if the event was handled (consumed).
     */
    async function handle(event: AgentStreamEvent): Promise<void> {
        switch (event.type) {
            case 'tool_result': {
                if (!event.success) return;

                let result: any = null;
                try {
                    result = typeof event.result === 'string' ? JSON.parse(event.result) : event.result;
                } catch {
                    /* ignore */
                }
                if (!result) return;

                // begin_document: emit document_start
                if (result.mode === 'draft' && (result.action === 'creating' || result.action === 'replacing')) {
                    const existing = await findDocumentByName(ctx.em, ctx.projectId, result.name);
                    const pendingVersion = existing ? existing.version + 1 : 1;
                    pendingVersions.set(event.id, pendingVersion);
                    names.set(event.id, result.name);
                    emit({ type: 'document_start', name: result.name, title: result.name, pendingVersion });
                }

                // finish_document, create_document, or replace_document: emit document_complete
                if (result.version !== undefined && result.lines !== undefined) {
                    const name = names.get(event.id) || result.name;
                    if (name) {
                        emit({
                            type: 'document_complete',
                            name,
                            version: result.version,
                            lines: result.lines,
                            action: result.action || 'created',
                        });
                    }
                    cleanup(event.id);
                }

                // edit_document: emit document_edit
                if (result.editsApplied !== undefined && result.linesNow !== undefined) {
                    emit({
                        type: 'document_edit',
                        name: result.name,
                        editsApplied: result.editsApplied,
                        linesNow: result.linesNow,
                        version: result.version,
                    });
                }
                break;
            }

            case 'early_validation_passed': {
                if (event.tool !== 'create_document' && event.tool !== 'replace_document') return;

                let parsed: { name?: string; title?: string } = {};
                try {
                    parsed = parsePartial(event.accumulatedArgs, STR | OBJ);
                } catch {
                    /* ignore */
                }
                if (!parsed.name) return;

                const normalizedName = normalizeDocumentName(parsed.name);
                const existing = await findDocumentByName(ctx.em, ctx.projectId, normalizedName);
                const pendingVersion = existing ? existing.version + 1 : 1;

                pendingVersions.set(event.id, pendingVersion);
                names.set(event.id, normalizedName);

                const parser = createStreamFieldParser({
                    toolName: event.tool,
                    field: 'content',
                    onDelta: (delta) => {
                        emit({ type: 'document_delta', name: normalizedName, pendingVersion, content: delta });
                    },
                });
                // Prime parser with all JSON accumulated so far (so content field is correctly parsed)
                parser.feed({ type: 'tool_call_delta', tool: event.tool, id: event.id, delta: event.accumulatedArgs });
                parsers.set(event.id, parser);

                emit({
                    type: 'document_start',
                    name: normalizedName,
                    title: parsed.title || normalizedName,
                    pendingVersion,
                });
                break;
            }

            case 'tool_call_delta': {
                let parser = parsers.get(event.id);

                // continue_document: lazy parser setup
                if (!parser && event.tool === 'continue_document') {
                    const acc = (accumulators.get(event.id) || '') + event.delta;
                    accumulators.set(event.id, acc);

                    try {
                        const parsed = JSON.parse(acc);
                        if (parsed.name) {
                            const normalizedName = normalizeDocumentName(parsed.name);
                            const existing = await findDocumentByName(ctx.em, ctx.projectId, normalizedName);
                            const pendingVersion = existing ? existing.version + 1 : 1;

                            pendingVersions.set(event.id, pendingVersion);
                            names.set(event.id, normalizedName);

                            parser = createStreamFieldParser({
                                toolName: event.tool,
                                field: 'content',
                                onDelta: (delta) => {
                                    emit({
                                        type: 'document_delta',
                                        name: normalizedName,
                                        pendingVersion,
                                        content: delta,
                                    });
                                },
                            });
                            parsers.set(event.id, parser);
                            accumulators.delete(event.id);
                        }
                    } catch {
                        /* not yet parseable */
                    }
                }

                if (parser) {
                    parser.feed(event);
                }
                break;
            }

            default:
                // Not a document-related event
                break;
        }
    }

    function cleanup(callId: string) {
        parsers.delete(callId);
        pendingVersions.delete(callId);
        names.delete(callId);
        accumulators.delete(callId);
    }

    return { handle };
}
