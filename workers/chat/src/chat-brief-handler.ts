/**
 * Force-brief routing — States A (proposed CB), B (already transitioned),
 * C (approved CB / no next chat), D (no CB / rejected → forced generation).
 *
 * All forced-transition states (A, C, D) emit `context_limit_transition_update`
 * user-events so any subscribed listener (incl. non-initiator tabs) can follow
 * the multi-stream transition. The same status is mirrored on
 * `chat.metadata.contextLimitTransition` for reconnect/restoration.
 */

import { ErrorStatus, PublicError } from '@common/common/error.helpers';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import type { SendChatActionDto } from '@/lib/schema/chat';
import { branchDoName } from '@/workers/_common/util/preview-alias';
import { approveArtifactProgrammatic } from './artifact-approver';
// Type-only — no runtime edge back to chat-handler.ts
import type {
    ChatActionResult,
    ChatHandlerOptions,
    chatActionHandler,
    GenerationParams,
    PreparedChatGenerationInput,
} from './chat-handler';
import type { Ctx } from './context';
import { runSummarizer } from './summarizer';
import { broadcastUserEvent } from './utils/broadcast';
import { buildContextGateError } from './utils/context-gate-error';
import type { UserGatewayStub } from './utils/do-stubs';
import { logCbMemoryCheckpoint } from './utils/memory-checkpoint';
import { findNextPhaseChat } from './utils/next-phase';
import { createEnqueue, createSSEStream } from './utils/stream-utils';

// ============================================================================
// TYPES
// ============================================================================

export type ForcedBriefStatus = 'generating_brief' | 'approving_brief' | 'starting_summary' | 'summarizing' | 'failed';

/**
 * Stable error codes for the `failed` marker. FE switches on these — do not
 * rename or remove without coordinating a FE change.
 */
export type ForcedBriefErrorCode =
    | 'NO_CB_PRODUCED'
    | 'CONTEXT_OVERFLOW'
    | 'CB_APPROVAL_FAILED'
    | 'CB_LOOKUP_FAILED'
    | 'SUMMARY_FAILED'
    | 'INCONSISTENT_STATE'
    | 'PREFLIGHT_REJECTED';

export interface ForcedBriefMarker {
    status: ForcedBriefStatus;
    errorCode?: ForcedBriefErrorCode;
    message?: string;
}

/** Runtime deps injected from chat-handler to avoid circular imports. */
export interface ForceBriefDeps {
    dispatchBlurb: typeof chatActionHandler;
    prepareChatGenerationInput: (opts: {
        data: SendChatActionDto;
        ctx: Ctx;
        chat: ChatEntity;
        options: ChatHandlerOptions;
    }) => Promise<PreparedChatGenerationInput | PublicError>;
    runGeneration: (params: GenerationParams) => Promise<void>;
}

// ============================================================================
// MARKER HELPERS
// ============================================================================

/** Persist the marker on chat.metadata + broadcast the user-event. */
async function updateForcedBriefStatus(
    ctx: Ctx,
    chat: ChatEntity,
    status: ForcedBriefStatus,
    extras?: { errorCode?: ForcedBriefErrorCode; message?: string },
): Promise<void> {
    const marker: ForcedBriefMarker = { status, ...(extras ?? {}) };
    chat.metadata = { ...(chat.metadata ?? {}), contextLimitTransition: marker };
    await ctx.em!.flush();
    logCbMemoryCheckpoint('force_brief.status', {
        requestId: ctx.requestId,
        chatId: chat.id,
        status,
        errorCode: extras?.errorCode,
    });
    await broadcastUserEvent(ctx, 'context_limit_transition_update', {
        chatId: chat.id,
        ...marker,
    });
}

/** Remove the marker from chat.metadata. Called on terminal states (success or failed). */
async function clearForcedBriefStatus(ctx: Ctx, chat: ChatEntity): Promise<void> {
    if (!chat.metadata || !('contextLimitTransition' in chat.metadata)) return;
    const next = { ...chat.metadata };
    delete next.contextLimitTransition;
    chat.metadata = next;
    await ctx.em!.flush();
}

/** Latest `proposed` version of the chat's Completion Brief, or null. */
async function findProposedCBVersion(em: EntityManager, chat: ChatEntity): Promise<ArtifactVersionEntity | null> {
    const cbArtifactId =
        chat.completion_brief &&
        (typeof chat.completion_brief === 'string' ? chat.completion_brief : chat.completion_brief.id);
    if (!cbArtifactId) return null;
    return em.findOne(
        ArtifactVersionEntity,
        { artifact: cbArtifactId, status: 'proposed' },
        { orderBy: { version: 'DESC' } },
    );
}

// ============================================================================
// SUMMARIZATION PHASE (shared by States A, C, D)
// ============================================================================

/**
 * Marks `starting_summary`, registers the summary stream on `chat:{chatId}`,
 * marks `summarizing`, runs `runSummarizer`, then clears the marker on success.
 * On failure: marks `failed` and leaves the marker persisted for reconnect.
 */
async function runSummarizationPhase(opts: {
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    ugStub: UserGatewayStub;
    alias: string | null | undefined;
    summarizerAgentMessageId: string;
    deps: ForceBriefDeps;
}): Promise<void> {
    const { ctx, options, chat, ugStub, alias, summarizerAgentMessageId, deps } = opts;
    const { em } = ctx;
    const chatId = chat.id;

    try {
        await updateForcedBriefStatus(ctx, chat, 'starting_summary');
        chat.active_agent_message_id = summarizerAgentMessageId;
        await em!.flush();

        await ugStub.systemAction(
            `chat:${chatId}`,
            'registerStream',
            {
                agentMessageId: summarizerAgentMessageId,
                userId: ctx.user.userId,
                streamType: 'summary',
            },
            alias ?? undefined,
        );

        await updateForcedBriefStatus(ctx, chat, 'summarizing');

        const success = await runSummarizer(
            {
                data: { chatId },
                ctx,
                options: {
                    overrideInference: options.overrideInference,
                    onEvent: options.onEvent,
                },
                chat,
                agentMessageId: summarizerAgentMessageId,
                ugStub,
            },
            { dispatchBlurb: deps.dispatchBlurb },
        );

        if (success) {
            await clearForcedBriefStatus(ctx, chat);
        } else {
            await updateForcedBriefStatus(ctx, chat, 'failed', {
                errorCode: 'SUMMARY_FAILED',
                message: 'Summarizer failed internally.',
            });
        }
    } catch (err) {
        console.error('[runSummarizationPhase] failure:', err);
        chat.active_agent_message_id = null;
        await updateForcedBriefStatus(ctx, chat, 'failed', {
            errorCode: 'SUMMARY_FAILED',
            message: err instanceof Error ? err.message : 'Summary phase failed.',
        });
    }
}

// ============================================================================
// SSE WRAPPER (States A, C)
// ============================================================================

/**
 * SSE/test-mode wrapper for the summarization phase. Used by States A and C.
 * Marker handling lives in `runSummarizationPhase`.
 */
async function runForceBriefSummarize(opts: {
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    deps: ForceBriefDeps;
}): Promise<ChatActionResult | ReadableStream> {
    const { ctx, options, chat, deps } = opts;

    const summarizerAgentMessageId = crypto.randomUUID();
    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;

    if (options.onEvent) {
        const generation = runSummarizationPhase({
            ctx,
            options,
            chat,
            ugStub,
            alias,
            summarizerAgentMessageId,
            deps,
        });
        return { agentMessageId: summarizerAgentMessageId, generation };
    }

    return createSSEStream(async (controller) => {
        const enqueue = createEnqueue(controller);
        enqueue({ type: 'ids', agentMessageId: summarizerAgentMessageId });
        const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);
        try {
            await runSummarizationPhase({
                ctx,
                options,
                chat,
                ugStub,
                alias,
                summarizerAgentMessageId,
                deps,
            });
        } finally {
            clearInterval(heartbeat);
        }
        try {
            controller.close();
        } catch {
            /* already closed */
        }
    }, ctx);
}

// ============================================================================
// STATE D — FORCED GENERATION
// ============================================================================

const STATE_D_SYNTHETIC_USER_MESSAGE =
    'Context window is at capacity. Generate the Completion Brief now and nothing else. ' +
    'The brief will be auto-approved and the next phase will start automatically.';

/**
 * State D — no CB exists yet. Persist a synthetic user message (so the agent has
 * something to act on), run the normal chat generation pipeline (force_brief makes
 * `pickInferenceParams` pick Sonnet 4.6), then sequentially approve the produced CB
 * and run the phase summary.
 *
 * Sequencing: forced chat stream must reach its terminal/finalized boundary BEFORE the
 * summary stream registers. `await runGeneration` enforces this — `runGeneration` calls
 * `finalizeStream` at the end of its own try block.
 *
 * Listeners follow the transition via `context_limit_transition_update`:
 * `generating_brief` → `approving_brief` → `starting_summary` → `summarizing` → cleared
 * (or `failed` on any gap/summary-phase error).
 */
async function runForcedBriefGeneration(opts: {
    data: SendChatActionDto;
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    deps: ForceBriefDeps;
}): Promise<ChatActionResult | ReadableStream | PublicError> {
    const { data, ctx, options, chat, deps } = opts;
    const { em } = ctx;
    const chatId = chat.id;
    const requestStartedAt = new Date();

    const userMessageId = crypto.randomUUID();
    const agentMessageId = crypto.randomUUID();
    const summarizerAgentMessageId = crypto.randomUUID();

    // Internal DTO. The schema's force_brief↔message refine only runs at the HTTP boundary;
    // the type itself permits this combination, and downstream code (pickInferenceParams,
    // evaluateContextGate) reads `force_brief: true` to pick Sonnet 4.6 + bypass the gate.
    const syntheticData: SendChatActionDto = {
        ...data,
        message: STATE_D_SYNTHETIC_USER_MESSAGE,
        force_brief: true,
    };
    logCbMemoryCheckpoint('force_brief.state_d_start', {
        requestId: ctx.requestId,
        chatId,
        userMessageId,
        agentMessageId,
        summarizerAgentMessageId,
    });

    await updateForcedBriefStatus(ctx, chat, 'generating_brief');

    const preparedInput = await deps.prepareChatGenerationInput({ data: syntheticData, ctx, chat, options });
    if (preparedInput instanceof PublicError) {
        await updateForcedBriefStatus(ctx, chat, 'failed', {
            errorCode: 'PREFLIGHT_REJECTED',
            message: preparedInput.message,
        });
        return preparedInput;
    }
    logCbMemoryCheckpoint('force_brief.prepared', {
        requestId: ctx.requestId,
        chatId,
        estimatedTokens: preparedInput.estimatedTokens,
    });

    // Synthetic user message — metadata.synthetic lets FE render it differently if desired.
    const syntheticMsg = em!.create(ChatMessageEntity, {
        id: userMessageId,
        chat: chatId,
        role: 'user',
        content: STATE_D_SYNTHETIC_USER_MESSAGE,
        created_at: requestStartedAt,
        metadata: { synthetic: true, reason: 'context_hard_gate' },
    });
    em!.persist(syntheticMsg);

    chat.active_agent_message_id = agentMessageId;
    await em!.flush();

    const alias = ctx.previewAlias;
    const ugId = ctx.env.USER_GATEWAY.idFromName(branchDoName(ctx.user.userId, alias));
    const ugStub = ctx.env.USER_GATEWAY.get(ugId) as unknown as UserGatewayStub;

    await ugStub.systemAction(
        `chat:${chatId}`,
        'messageCreated',
        { message: syntheticMsg.toJSON() },
        alias ?? undefined,
    );

    await ugStub.systemAction(
        `chat:${chatId}`,
        'registerStream',
        {
            agentMessageId,
            userId: ctx.user.userId,
            userMessageId,
        },
        alias ?? undefined,
    );

    // Synthetic message is system-driven; skip safety check.
    const safetyPromise: Promise<null> = Promise.resolve(null);

    const runFlow = async () => {
        // Phase 1: forced chat generation. runGeneration handles its own errors internally
        // (persists assistant error message, records context-overflow metadata, cleans up DO).
        logCbMemoryCheckpoint('force_brief.run_generation_start', {
            requestId: ctx.requestId,
            chatId,
            agentMessageId,
        });
        await deps.runGeneration({
            data: syntheticData,
            ctx,
            options,
            chat,
            agentMessageId,
            requestStartedAt,
            ugStub,
            preparedInput,
            safetyPromise,
        });
        logCbMemoryCheckpoint('force_brief.run_generation_done', {
            requestId: ctx.requestId,
            chatId,
            agentMessageId,
        });

        // Phase 2 (gap): locate produced CB + approve.
        // We key off whether a proposed CB exists, NOT whether runGeneration itself errored.
        // If the agent produced a CB via finalize_document before the turn errored, the CB
        // content is valid (finalize_document validates before persisting). If no CB exists,
        // we emit NO_CB_PRODUCED or CONTEXT_OVERFLOW and stop.
        let cbVersion: ArtifactVersionEntity | null;
        try {
            cbVersion = await findProposedCBVersion(em!, chat);
        } catch (err) {
            console.error('[runForcedBriefGeneration] CB lookup failed:', err);
            await updateForcedBriefStatus(ctx, chat, 'failed', {
                errorCode: 'CB_LOOKUP_FAILED',
                message: err instanceof Error ? err.message : 'CB lookup failed.',
            });
            return;
        }
        if (!cbVersion) {
            const hadOverflow = (chat.metadata as Record<string, unknown> | undefined)?.contextOverflow != null;
            await updateForcedBriefStatus(ctx, chat, 'failed', {
                errorCode: hadOverflow ? 'CONTEXT_OVERFLOW' : 'NO_CB_PRODUCED',
                message: hadOverflow
                    ? 'Context window overflow during forced brief generation.'
                    : 'Forced brief run did not produce a Completion Brief.',
            });
            return;
        }
        logCbMemoryCheckpoint('force_brief.cb_found', {
            requestId: ctx.requestId,
            chatId,
            versionId: cbVersion.id,
            version: cbVersion.version,
        });

        await updateForcedBriefStatus(ctx, chat, 'approving_brief');
        try {
            await approveArtifactProgrammatic(ctx, cbVersion.id, { reason: 'context_hard_gate' });
        } catch (err) {
            console.error('[runForcedBriefGeneration] approval failed:', err);
            await updateForcedBriefStatus(ctx, chat, 'failed', {
                errorCode: 'CB_APPROVAL_FAILED',
                message: err instanceof Error ? err.message : 'CB approval failed.',
            });
            return;
        }

        // Phase 3: summary stream. runSummarizationPhase handles its own marker transitions.
        logCbMemoryCheckpoint('force_brief.summary_start', {
            requestId: ctx.requestId,
            chatId,
            summarizerAgentMessageId,
        });
        await runSummarizationPhase({
            ctx,
            options,
            chat,
            ugStub,
            alias,
            summarizerAgentMessageId,
            deps,
        });
    };

    if (options.onEvent) {
        const generation = runFlow();
        return { userMessageId, agentMessageId, generation };
    }

    return createSSEStream(
        async (controller) => {
            const enqueue = createEnqueue(controller);
            enqueue({ type: 'ids', userMessageId, agentMessageId });
            const heartbeat = setInterval(() => enqueue(':keepalive'), 10_000);
            try {
                await runFlow();
            } finally {
                clearInterval(heartbeat);
            }
            try {
                controller.close();
            } catch {
                /* already closed */
            }
        },
        ctx,
        { debugMemory: true },
    );
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Route a `{ message: null, force_brief: true }` request by inspecting CB state.
 *
 * - **State B** — next-phase chat exists → refuse with already-transitioned details.
 * - **State A** — `proposed` CB → mark `approving_brief`, approve, summarize.
 * - **State C** — `approved` CB / no next chat → summarize (recovery).
 * - **State D** — no CB / `rejected` → forced generation flow.
 */
export async function handleForceBrief(opts: {
    data: SendChatActionDto;
    ctx: Ctx;
    options: ChatHandlerOptions;
    chat: ChatEntity;
    deps: ForceBriefDeps;
}): Promise<ChatActionResult | ReadableStream | PublicError> {
    const { data, ctx, options, chat, deps } = opts;
    const { em } = ctx;
    const { chatId } = data;

    // State B — next-phase chat already exists. Pre-flight refusal; no marker emitted
    // because no transition is in progress and no state changes.
    const nextChat = await findNextPhaseChat(em!, {
        sourceChatId: chatId,
        projectId: chat.project!.id,
    });
    if (nextChat) {
        return new PublicError(
            ErrorStatus.BadRequest,
            buildContextGateError({
                gate: 'hard',
                source: 'already_transitioned',
                canBypass: false,
                canForceBrief: false,
                existingNextChatId: nextChat.id,
            }),
        );
    }

    const status = chat.completion_brief_status;

    if (status === 'proposed') {
        // State A — approve before any stream registration.
        const cbVersion = await findProposedCBVersion(em!, chat);
        if (!cbVersion) {
            return new PublicError(ErrorStatus.ServerError, {
                code: 'INCONSISTENT_STATE',
                message: 'Chat marked completion_brief_status=proposed but no proposed CB version was found.',
            });
        }
        await updateForcedBriefStatus(ctx, chat, 'approving_brief');
        try {
            await approveArtifactProgrammatic(ctx, cbVersion.id, { reason: 'context_hard_gate' });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'CB approval failed.';
            await updateForcedBriefStatus(ctx, chat, 'failed', { errorCode: 'CB_APPROVAL_FAILED', message });
            return new PublicError(ErrorStatus.ServerError, { code: 'CB_APPROVAL_FAILED', message });
        }
        return runForceBriefSummarize({ ctx, options, chat, deps });
    }

    if (status === 'approved') {
        // State C — recovery: CB already approved, just run the summarizer.
        return runForceBriefSummarize({ ctx, options, chat, deps });
    }

    // State D — null or 'rejected'. Forced generation: synthesize user msg, run agent,
    // approve produced CB, run summarizer.
    return runForcedBriefGeneration({ data, ctx, options, chat, deps });
}
