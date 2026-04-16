/**
 * Stream Runner — shared stream loop and infrastructure for all agent handlers.
 *
 * Extracts the duplicated patterns from chat-handler, intake-handler, and
 * summarizer into reusable utilities. Each handler retains its own
 * done_ext handling and agent setup logic.
 */

import type { AgentStreamEvent } from '@common/ai/agent/types';
import type { StreamEvent } from '@/lib/schema/stream';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import type { Ctx } from '../context';
import type { DocumentToolsContext, DraftManager } from '../tools/documents';
import type { ChatStreamDOStub, UserGatewayStub } from './do-stubs';
import { createDocumentEventHandler, type DocumentContext } from './document-events';
import { createEventCollector, createPusher, handleCommonStreamEvent, type Pusher, wireAbort } from './stream-utils';

// ============================================================================
// STREAM INFRASTRUCTURE SETUP
// ============================================================================

export interface StreamInfra {
    streamDO: ChatStreamDOStub;
    abortController: AbortController;
    pusher: Pusher;
}

/**
 * Set up the ChatStream DO stub, abort wiring, and fire-and-forget pusher.
 * Identical across all three handlers.
 */
export function setupStreamInfra(agentMessageId: string, ctx: Ctx, tag: string): StreamInfra {
    const alias = ctx.previewAlias;
    const streamDO = ctx.env.CHAT_STREAM_DO.get(
        ctx.env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, alias)),
    ) as unknown as ChatStreamDOStub;
    const abortController = wireAbort(streamDO);
    const pusher = createPusher(streamDO, tag);
    return { streamDO, abortController, pusher };
}

// ============================================================================
// STREAM LOOP
// ============================================================================

export interface StreamLoopConfig {
    /** The agent stream to consume */
    stream: AsyncIterable<AgentStreamEvent>;
    /** Fire-and-forget push function (typically `pusher.push`) */
    push: (events: StreamEvent[]) => void;
    /** Context for the document event handler */
    docEventsCtx: DocumentContext;
    /**
     * Called for each raw agent event before common handling.
     * Use for safety monitoring, status updates, draft mutations, etc.
     */
    onAgentEvent?: (event: AgentStreamEvent) => void;
    /**
     * Called for events not consumed by the common handler (done, done_ext, etc.).
     */
    onSpecificEvent: (event: AgentStreamEvent) => void | Promise<void>;
    /** Test event tap — receives doc events and drained common events */
    onEvent?: (event: StreamEvent) => void;
}

/**
 * Process the agent stream with shared doc-event handling, event collection,
 * and batched pushing. Handler-specific logic goes in the callbacks.
 */
export async function runStreamLoop(config: StreamLoopConfig): Promise<void> {
    const pendingDocEvents: StreamEvent[] = [];
    const docEvents = createDocumentEventHandler(config.docEventsCtx, (docEvent) => {
        const se = docEvent as StreamEvent;
        pendingDocEvents.push(se);
        config.onEvent?.(se);
    });
    const collector = createEventCollector();
    const state = { wasTool: false };

    for await (const event of config.stream) {
        config.onAgentEvent?.(event);

        await docEvents.handle(event);

        if (handleCommonStreamEvent(collector.enqueue, event, state)) {
            const events = collector.drain();
            const combined = [...pendingDocEvents.splice(0), ...events];
            if (combined.length > 0) {
                config.push(combined);
                if (config.onEvent) events.forEach((e) => config.onEvent!(e));
            }
            continue;
        }

        if (pendingDocEvents.length > 0) {
            config.push(pendingDocEvents.splice(0));
        }

        await config.onSpecificEvent(event);
    }
}

// ============================================================================
// STREAM FINALIZATION
// ============================================================================

/**
 * Post-stream cleanup: done -> finalize -> clearStream.
 * Call after historyPromise and optional safety monitor finalization.
 */
export async function finalizeStream(
    streamDO: ChatStreamDOStub,
    ugStub: UserGatewayStub,
    topic: string,
): Promise<void> {
    try {
        await streamDO.done();
        await streamDO.finalize();
    } finally {
        await ugStub.systemAction(topic, 'clearStream', {}).catch(() => {});
    }
}

// ============================================================================
// ON-TURN-COMPLETE FACTORY
// ============================================================================

/**
 * Create the onTurnComplete callback with draft-check and optional PECP-check.
 * Used by chat-handler (pecp: true), summarizer (pecp: true), and intake (pecp: false).
 */
export function createOnTurnComplete(
    agentCtx: { draftManager: DraftManager; pendingPECP?: DocumentToolsContext['pendingPECP'] },
    options: { pecp?: boolean } = {},
): () => string | null {
    return () => {
        if (agentCtx.draftManager.hasActive()) {
            return 'You have an unfinalized document draft. You MUST call finalize_document now or the content will be lost.';
        }
        if (options.pecp && agentCtx.pendingPECP) {
            const p = agentCtx.pendingPECP;
            return `You MUST generate a PECP for "${p.parentDocumentType}". Call begin_document with mode="create", name="${p.pecpKey}", document_type="PECP", parent_document="${p.parentDocument}". Write the PE-facing communication using the appropriate PECP stage template from your system prompt, then finalize.`;
        }
        return null;
    };
}
