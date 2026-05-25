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
import type { DraftManager } from '../tools/documents';
import type { ChatStreamDOStub, UserGatewayStub } from './do-stubs';
import { createDocumentEventHandler, type DocumentContext, type DocumentEvent } from './document-events';
import {
    type CommonStreamEventOpts,
    createEventCollector,
    createPusher,
    handleCommonStreamEvent,
    type Pusher,
    wireAbort,
} from './stream-utils';

// ============================================================================
// STREAM INFRASTRUCTURE SETUP
// ============================================================================

export interface StreamInfra {
    streamDO: ChatStreamDOStub;
    abortController: AbortController;
    pusher: Pusher;
}

export interface StreamInfraOptions {
    debugMemory?: boolean;
}

/**
 * Set up the ChatStream DO stub, abort wiring, and fire-and-forget pusher.
 * Identical across all three handlers.
 */
export function setupStreamInfra(
    agentMessageId: string,
    ctx: Ctx,
    tag: string,
    options: StreamInfraOptions = {},
): StreamInfra {
    const alias = ctx.previewAlias;
    const streamDO = ctx.env.CHAT_STREAM_DO.get(
        ctx.env.CHAT_STREAM_DO.idFromName(branchDoName(agentMessageId, alias)),
    ) as unknown as ChatStreamDOStub;
    const abortController = wireAbort(streamDO);
    const pusher = createPusher(streamDO, tag, { debugMemory: options.debugMemory });
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
    /** Called on every emitted DocumentEvent — used to broadcast user-scoped events (artifact_stream_started/completed) cross-tab. */
    onDocumentEvent?: (event: DocumentEvent) => void;
    /** Options forwarded to handleCommonStreamEvent (e.g. draft-internal callback for input redaction). */
    commonEventOpts?: CommonStreamEventOpts;
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
        config.onDocumentEvent?.(docEvent);
    });
    const collector = createEventCollector();
    const state = { wasTool: false };

    for await (const event of config.stream) {
        config.onAgentEvent?.(event);

        await docEvents.handle(event);

        if (handleCommonStreamEvent(collector.enqueue, event, state, config.commonEventOpts)) {
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
 * Create the onTurnComplete callback that nudges the agent if it left a draft un-finalized.
 * The PECP/internal-summary side-effect runs synchronously inside finalize_document, so
 * there is no longer a "still need to write the PECP" handoff to police here.
 */
export function createOnTurnComplete(agentCtx: { draftManager: DraftManager }): () => string | null {
    return () => {
        if (agentCtx.draftManager.hasActive()) {
            return 'You have an unfinalized document draft. You MUST call finalize_document now or the content will be lost.';
        }
        return null;
    };
}
