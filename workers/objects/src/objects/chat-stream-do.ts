import { DurableObject } from 'cloudflare:workers';
import type { StreamBlock } from '@common/ai/agent/types';
import type { ActiveDocument, StreamEvent, StreamSnapshot, StreamStatus } from '@/lib/schema/stream';
import createNeonSql from '@/workers/_common/vendor/neon';

// Re-export shared types for consumers that imported from here
export type { ActiveDocument, DocumentEdit, StreamEvent, StreamSnapshot, StreamStatus } from '@/lib/schema/stream';

// ============================================================================
// CONSTANTS
// ============================================================================

const DEAD_MAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const ABORT_WAIT_TIMEOUT_MS = 60_000; // 60 seconds
const TOOL_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Storage keys
const SK_BLOCKS = 'blocks';
const SK_ACTIVE_DOCS = 'activeDocuments';
const SK_STATUS = 'status';
const SK_SUBSCRIBERS = 'subscribers';
const SK_CHAT_ID = 'chatId';
const SK_AGENT_MSG_ID = 'agentMessageId';
const SK_USER_MSG_ID = 'userMessageId';
const SK_TEXT_BLOCK_ID = 'currentTextBlockId';
const SK_REASONING_BLOCK_ID = 'currentReasoningBlockId';
const SK_TOPIC_PREFIX = 'topicPrefix';

// ============================================================================
// CHAT STREAM DO
// ============================================================================

/**
 * ChatStream DO — ephemeral per-response stream buffer and signal broker.
 *
 * Keyed by agentMessageId (the same UUID used as the DB message ID).
 * Buffers StreamBlock[] + ActiveDocument[] state, manages subscribers,
 * and provides long-poll RPC for abort/tool approval.
 *
 * Lifecycle: created via init() → push() loop → done() → finalize().
 * Dead-man's switch alarm fires if Worker crashes mid-stream.
 */
export class ChatStreamDO extends DurableObject<Env> {
    // --- Persisted state (survives hibernation via ctx.storage) ---
    private blocks: StreamBlock[] = [];
    private activeDocuments = new Map<string, ActiveDocument>();
    private status: StreamStatus | 'idle' = 'idle';
    private subscribers = new Map<string, string>(); // userId → UG DO name
    private chatId = '';
    private agentMessageId = '';
    private userMessageId = '';
    /** Topic prefix for UG broadcasts (e.g. 'chat' or 'intake') */
    private topicPrefix = 'chat';
    private currentTextBlockId: string | null = null;
    private currentReasoningBlockId: string | null = null;

    // --- In-memory state (lost on hibernation) ---
    private abortResolve: ((value: 'abort' | 'done') => void) | null = null;
    private approvalResolvers = new Map<string, (approved: boolean) => void>();
    private initialized = false;

    /** Lazy-load state from storage on first RPC call */
    private async ensureLoaded() {
        if (this.initialized) return;
        this.initialized = true;

        const [
            blocks,
            activeDocs,
            status,
            subscribers,
            chatId,
            agentMsgId,
            userMsgId,
            textBlockId,
            reasoningBlockId,
            topicPrefix,
        ] = await Promise.all([
            this.ctx.storage.get<StreamBlock[]>(SK_BLOCKS),
            this.ctx.storage.get<[string, ActiveDocument][]>(SK_ACTIVE_DOCS),
            this.ctx.storage.get<StreamStatus | 'idle'>(SK_STATUS),
            this.ctx.storage.get<[string, string][]>(SK_SUBSCRIBERS),
            this.ctx.storage.get<string>(SK_CHAT_ID),
            this.ctx.storage.get<string>(SK_AGENT_MSG_ID),
            this.ctx.storage.get<string>(SK_USER_MSG_ID),
            this.ctx.storage.get<string | null>(SK_TEXT_BLOCK_ID),
            this.ctx.storage.get<string | null>(SK_REASONING_BLOCK_ID),
            this.ctx.storage.get<string>(SK_TOPIC_PREFIX),
        ]);

        if (blocks) this.blocks = blocks;
        if (activeDocs) this.activeDocuments = new Map(activeDocs);
        if (status) this.status = status;
        if (subscribers) this.subscribers = new Map(subscribers);
        if (chatId) this.chatId = chatId;
        if (agentMsgId) this.agentMessageId = agentMsgId;
        if (userMsgId) this.userMessageId = userMsgId;
        if (textBlockId) this.currentTextBlockId = textBlockId;
        if (reasoningBlockId) this.currentReasoningBlockId = reasoningBlockId;
        if (topicPrefix) this.topicPrefix = topicPrefix;
    }

    /** Persist all mutable state to storage */
    private async persistState() {
        await this.ctx.storage.put({
            [SK_BLOCKS]: this.blocks,
            [SK_ACTIVE_DOCS]: [...this.activeDocuments.entries()],
            [SK_STATUS]: this.status,
            [SK_SUBSCRIBERS]: [...this.subscribers.entries()],
            [SK_CHAT_ID]: this.chatId,
            [SK_AGENT_MSG_ID]: this.agentMessageId,
            [SK_USER_MSG_ID]: this.userMessageId,
            [SK_TEXT_BLOCK_ID]: this.currentTextBlockId,
            [SK_REASONING_BLOCK_ID]: this.currentReasoningBlockId,
            [SK_TOPIC_PREFIX]: this.topicPrefix,
        });
    }

    // ========================================================================
    // EVENT APPLY LOGIC
    // ========================================================================

    /**
     * Apply a StreamEvent to internal state (blocks + activeDocuments).
     * Mirrors the frontend's useStreamReader apply logic.
     */
    private applyEvent(event: StreamEvent): void {
        switch (event.type) {
            // --- Text ---
            case 'delta': {
                if (!this.currentTextBlockId) {
                    const blockId = event.blockId || `text-${Date.now()}`;
                    this.currentTextBlockId = blockId;
                    this.blocks.push({ id: blockId, type: 'text', content: '' });
                }
                const textBlock = this.blocks.find((b) => b.id === this.currentTextBlockId);
                if (textBlock) textBlock.content += event.text;
                break;
            }

            case 'created':
                // Message ID assigned by backend — not relevant for DO state
                break;

            // --- Reasoning ---
            case 'reasoning_start': {
                const blockId = event.blockId || `reasoning-${Date.now()}`;
                this.currentReasoningBlockId = blockId;
                this.blocks.push({ id: blockId, type: 'reasoning', content: '' });
                break;
            }

            case 'reasoning_delta': {
                if (this.currentReasoningBlockId) {
                    const block = this.blocks.find((b) => b.id === this.currentReasoningBlockId);
                    if (block) block.content += event.text || event.content || '';
                }
                break;
            }

            case 'reasoning_done': {
                if (this.currentReasoningBlockId) {
                    const block = this.blocks.find((b) => b.id === this.currentReasoningBlockId);
                    if (block && block.type === 'reasoning' && event.durationMs !== undefined) {
                        block.durationMs = event.durationMs;
                    }
                }
                this.currentReasoningBlockId = null;
                break;
            }

            // --- Tool calls ---
            case 'tool_start': {
                this.blocks.push({
                    id: event.id || `tool-${Date.now()}`,
                    type: 'tool_call',
                    content: '',
                    toolName: event.tool,
                    toolInput: {},
                    toolCallId: event.id,
                });
                break;
            }

            case 'tool_result': {
                const toolBlock = this.blocks.find((b) => b.type === 'tool_call' && b.toolCallId === event.id);
                if (toolBlock && toolBlock.type === 'tool_call') {
                    const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
                    toolBlock.content = result;
                    toolBlock.toolOutput = result;
                    toolBlock.toolSuccess = event.success;
                }
                break;
            }

            // --- Search & citations ---
            case 'search_start': {
                this.blocks.push({
                    id: event.blockId || `search-${Date.now()}`,
                    type: 'search',
                    content: event.query,
                    searchQuery: event.query,
                });
                break;
            }

            case 'search_results': {
                const searchBlock = this.blocks.find((b) => b.id === event.blockId && b.type === 'search');
                if (searchBlock && searchBlock.type === 'search') {
                    searchBlock.resultCount = event.resultCount;
                    searchBlock.isComplete = true;
                }
                break;
            }

            case 'citation': {
                const parentBlock = this.blocks.find((b) => b.id === event.parentTextBlockId && b.type === 'text');
                if (parentBlock && parentBlock.type === 'text') {
                    if (!parentBlock.citations) parentBlock.citations = [];
                    parentBlock.citations.push({
                        url: event.url,
                        title: event.title,
                        cited_text: event.citedText,
                        start_index: event.startIndex,
                        end_index: event.endIndex,
                        provider: 'anthropic',
                    });
                }
                break;
            }

            // --- Documents/artifacts ---
            case 'document_start': {
                this.activeDocuments.set(event.name, {
                    name: event.name,
                    title: event.title ?? event.name,
                    mode: event.mode ?? 'create',
                    pendingVersion: event.pendingVersion,
                    loadedVersion: event.loadedVersion,
                    content: '',
                });
                break;
            }

            case 'document_delta': {
                const doc = this.activeDocuments.get(event.name);
                if (doc) doc.content += event.content;
                break;
            }

            case 'document_edit': {
                const doc = this.activeDocuments.get(event.name);
                if (doc) {
                    const lines = doc.content.split('\n');
                    for (const edit of [...event.edits].reverse()) {
                        const before = lines.slice(0, Math.max(0, edit.startLine - 1));
                        const after = lines.slice(edit.endLine);
                        const replacement = edit.newContent ? edit.newContent.split('\n') : [];
                        lines.length = 0;
                        lines.push(...before, ...replacement, ...after);
                    }
                    doc.content = lines.join('\n');
                }
                break;
            }

            case 'document_complete': {
                this.activeDocuments.delete(event.name);
                break;
            }

            // --- Status & terminal ---
            case 'status_update':
            case 'done':
            case 'done_ext':
            case 'error':
                // Stream status managed by dedicated RPC methods (done(), abort(), etc.)
                // These events are still broadcast to subscribers for frontend processing
                break;

            default:
                break;
        }
    }

    // ========================================================================
    // BROADCASTING
    // ========================================================================

    private get topic(): string {
        return `${this.topicPrefix}:${this.chatId}`;
    }

    private async broadcast(event: StreamEvent) {
        const sends: Promise<void>[] = [];
        for (const [userId] of this.subscribers) {
            sends.push(
                this.sendToSubscriber(userId, {
                    topic: this.topic,
                    type: 'stream_event',
                    agentMessageId: this.agentMessageId,
                    event,
                }),
            );
        }
        await Promise.allSettled(sends);
    }

    private async broadcastStatus(status: StreamStatus) {
        const sends: Promise<void>[] = [];
        for (const [userId] of this.subscribers) {
            sends.push(
                this.sendToSubscriber(userId, {
                    topic: this.topic,
                    type: 'stream_status',
                    status,
                    agentMessageId: this.agentMessageId,
                }),
            );
        }
        await Promise.allSettled(sends);
    }

    /** Send a pre-formatted message to a subscriber via UG's pushMessage (raw passthrough). */
    private async sendToSubscriber(userId: string, message: unknown): Promise<void> {
        const ugDoName = this.subscribers.get(userId);
        if (!ugDoName) return;

        try {
            const ugId = this.env.USER_GATEWAY.idFromName(ugDoName);
            const ugStub = this.env.USER_GATEWAY.get(ugId) as DurableObjectStub & {
                pushMessage(topic: string, message: unknown): Promise<void>;
            };
            await ugStub.pushMessage(this.topic, message);
        } catch (err) {
            console.error(`ChatStreamDO: failed to push to subscriber ${userId}:`, err);
        }
    }

    // ========================================================================
    // RPC METHODS
    // ========================================================================

    /**
     * Push stream events — apply to state, broadcast to subscribers, reset dead-man alarm.
     */
    async push(events: StreamEvent[]) {
        await this.ensureLoaded();

        if (this.status === 'idle') {
            this.status = 'streaming';
        }

        for (const event of events) {
            this.applyEvent(event);
        }

        await this.persistState();

        // Reset dead-man's switch
        await this.ctx.storage.setAlarm(Date.now() + DEAD_MAN_TIMEOUT_MS);

        // Broadcast each event to live subscribers
        for (const event of events) {
            await this.broadcast(event);
        }
    }

    /**
     * Mark stream as done, broadcast terminal status.
     */
    async done() {
        await this.ensureLoaded();
        // If already terminal (aborted/error), don't override — just resolve dangling promises
        if (this.status === 'aborted' || this.status === 'error') {
            this.abortResolve?.('done');
            this.abortResolve = null;
            return;
        }
        this.status = 'done';
        // Resolve any pending abortWait so the timer doesn't dangle for 60s
        this.abortResolve?.('done');
        this.abortResolve = null;
        await this.persistState();
        await this.broadcastStatus('done');
    }

    /**
     * Initialize the DO with chatId and agentMessageId. Must be called once
     * before any subscribe or push. Sets status idle, starts dead-man alarm.
     *
     * Called by ChatTopicHandler.registerStream() before broadcasting stream_started.
     */
    async init(chatId: string, agentMessageId: string, userMessageId: string, topicPrefix = 'chat') {
        await this.ensureLoaded();
        this.chatId = chatId;
        this.agentMessageId = agentMessageId;
        this.userMessageId = userMessageId;
        this.topicPrefix = topicPrefix;
        this.status = 'idle';
        await this.persistState();
        // Start dead-man alarm — if no push() arrives, alarm fires and cleans up
        await this.ctx.storage.setAlarm(Date.now() + DEAD_MAN_TIMEOUT_MS);
    }

    /**
     * Abort the stream — sets status, resolves abort promise, broadcasts.
     * @param chatId — must match the stored chatId or the call is rejected.
     */
    async abort(chatId?: string) {
        await this.ensureLoaded();
        if (chatId && this.chatId && chatId !== this.chatId) {
            throw new Error('chatId mismatch');
        }
        this.status = 'aborted';
        this.abortResolve?.('abort');
        this.abortResolve = null;
        await this.persistState();
        await this.broadcastStatus('aborted');
    }

    /**
     * Long-poll that resolves on abort signal or timeout.
     * Worker races this against reader.read().
     */
    async abortWait(): Promise<'abort' | 'timeout' | 'done'> {
        await this.ensureLoaded();

        if (this.status === 'aborted') return 'abort';
        if (this.status === 'done') return 'done';

        // Resolve any previous dangling listener to prevent orphaned promises
        this.abortResolve?.('timeout');

        return new Promise<'abort' | 'timeout' | 'done'>((resolve) => {
            this.abortResolve = resolve;
            setTimeout(() => {
                this.abortResolve = null;
                resolve('timeout');
            }, ABORT_WAIT_TIMEOUT_MS);
        });
    }

    /**
     * Register a subscriber and return the current snapshot.
     */
    async subscribe(userId: string, ugDoName: string): Promise<StreamSnapshot> {
        await this.ensureLoaded();

        this.subscribers.set(userId, ugDoName);
        await this.ctx.storage.put(SK_SUBSCRIBERS, [...this.subscribers.entries()]);

        return {
            blocks: this.blocks,
            activeDocuments: [...this.activeDocuments.values()],
            status: this.status === 'idle' ? 'streaming' : this.status,
        };
    }

    /**
     * Remove a subscriber.
     */
    async unsubscribe(userId: string) {
        await this.ensureLoaded();
        this.subscribers.delete(userId);
        await this.ctx.storage.put(SK_SUBSCRIBERS, [...this.subscribers.entries()]);
    }

    /**
     * Self-destruct — clear all state, let DO expire.
     * Called by Worker after DB persistence.
     */
    async finalize() {
        // Clear in-memory
        this.blocks = [];
        this.activeDocuments.clear();
        this.subscribers.clear();
        this.abortResolve = null;
        this.approvalResolvers.clear();
        this.status = 'idle';
        this.currentTextBlockId = null;
        this.currentReasoningBlockId = null;

        // Clear storage
        await this.ctx.storage.deleteAll();
        await this.ctx.storage.deleteAlarm();
    }

    /**
     * Set stream to pending_approval status and broadcast.
     * Called by Worker when a tool requires human approval.
     */
    async setPendingApproval(toolCallId: string, tool: string, input: unknown) {
        await this.ensureLoaded();
        this.status = 'pending_approval';
        await this.persistState();
        // TODO: broadcast tool info (toolCallId, tool, input) so client knows which tool needs approval
        await this.broadcastStatus('pending_approval');
    }

    /**
     * Resolve a tool approval long-poll — approved.
     */
    async toolApprove(toolCallId: string) {
        await this.ensureLoaded();
        const resolver = this.approvalResolvers.get(toolCallId);
        if (resolver) {
            resolver(true);
            this.approvalResolvers.delete(toolCallId);
        }
        this.status = 'streaming';
        await this.persistState();
        await this.broadcastStatus('streaming');
    }

    /**
     * Resolve a tool approval long-poll — rejected.
     */
    async toolReject(toolCallId: string) {
        await this.ensureLoaded();
        const resolver = this.approvalResolvers.get(toolCallId);
        if (resolver) {
            resolver(false);
            this.approvalResolvers.delete(toolCallId);
        }
        this.status = 'aborted';
        await this.persistState();
        await this.broadcastStatus('aborted');
    }

    /**
     * Long-poll for user tool approval/rejection decision.
     * Resolves true (approved) or false (rejected).
     */
    async toolApprovalWait(toolCallId: string): Promise<boolean> {
        await this.ensureLoaded();

        return new Promise<boolean>((resolve) => {
            this.approvalResolvers.set(toolCallId, resolve);
            setTimeout(() => {
                // Timeout → treat as rejection
                if (this.approvalResolvers.has(toolCallId)) {
                    this.approvalResolvers.delete(toolCallId);
                    resolve(false);
                }
            }, TOOL_APPROVAL_TIMEOUT_MS);
        });
    }

    // ========================================================================
    // DEAD-MAN'S SWITCH (ALARM)
    // ========================================================================

    /**
     * DO alarm handler — dead-man's switch.
     * If stream is still active with no recent push, transition to error,
     * save errored empty agent message to DB, clear entity, then self-destruct.
     */
    async alarm() {
        await this.ensureLoaded();

        // Only trigger if stream is still active
        if (this.status === 'streaming' || this.status === 'pending_approval') {
            console.error(`ChatStreamDO: dead-man alarm fired for ${this.agentMessageId}, status was ${this.status}`);
            this.status = 'error';
            await this.persistState();
            await this.broadcastStatus('error');
            // DB cleanup: save errored placeholder message + clear activeAgentMessageId
            await this.dbCleanup();
            // Self-destruct after broadcasting error and DB cleanup
            await this.finalize();
        }
    }

    // ========================================================================
    // DB CLEANUP (dead-man's switch only)
    // ========================================================================

    /**
     * Save an errored empty agent message and clear activeAgentMessageId on the chat entity.
     * Called only from the alarm handler (Worker crash recovery). Uses raw postgres
     * to avoid MikroORM initialization overhead in a rarely-fired cleanup path.
     */
    private async dbCleanup() {
        if (!this.chatId || !this.agentMessageId) {
            console.warn('ChatStreamDO: skipping DB cleanup — missing chatId or agentMessageId');
            return;
        }

        try {
            const sql = await createNeonSql(this.env);

            // Save errored empty agent message (idempotent — skip if already exists)
            await sql`
				INSERT INTO chat_messages (id, created_at, role, content, chat_id, blocks, is_error)
				VALUES (${this.agentMessageId}, NOW(), 'assistant', '', ${this.chatId}, '[]'::jsonb, true)
				ON CONFLICT (id) DO NOTHING
			`;

            // Clear active_agent_message_id (only if it still points to us)
            await sql`
				UPDATE chats SET active_agent_message_id = NULL
				WHERE id = ${this.chatId} AND active_agent_message_id = ${this.agentMessageId}
			`;
        } catch (err) {
            console.error('ChatStreamDO: DB cleanup failed', err);
        }
    }
}
