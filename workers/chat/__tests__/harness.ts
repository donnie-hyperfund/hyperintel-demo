/**
 * Chat handler integration test harness.
 *
 * Provides a multi-turn test session that calls the real `chatActionHandler`
 * with real inference, real DB, and mocked CF primitives.
 *
 * Requires in .env.test:
 *   DATABASE_URL + at least one provider key (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY)
 *
 * Optional:
 *   LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_HOST — if absent, uses local .md prompts from zlocal/prompts/
 *   TEST_PRESET    — preset ID for inference (default: 'sonnet')
 *   TEST_VERBOSE   — print user/assistant messages and tool calls to console
 *   TEST_CACHE_KEY — cache namespace (e.g. 'v1'). Enables checkpoint caching for sendCached().
 *   TEST_SKIP_CACHE — set to 'true' to force live inference and overwrite existing checkpoints
 */

import Anthropic from '@anthropic-ai/sdk';
import { MockDurableObjectNamespace } from '@common/common/local.do-mock';
import { makeSecretMock } from '@common/common/local.helpers';
import type { EntityManager } from '@mikro-orm/postgresql';
import OpenAI from 'openai';
import { OpenRouter } from '@openrouter/sdk';

import { chatActionHandler } from '../src/chat-handler';
import type { ChatActionResult, ChatHandlerOptions } from '../src/chat-handler';
import type { Ctx } from '../src/context';
import type { StreamEvent } from '@/lib/schema/stream';

import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getTestEm, getTestOrm, clearDatabase, closeTestOrm } from '@/tests/helpers/db';
import { getCacheKey, shouldSkipCache, hasCheckpoint, loadCheckpoint, saveCheckpoint, type CacheKeyVars } from './checkpoint';
import { resolvePreset } from '@/lib/presets';

// ============================================================================
// ENV CHECK
// ============================================================================

export function canRunChatTests(): boolean {
	if (process.env.TEST_LLM !== 'true') return false;
	if (!process.env.DATABASE_URL) return false;
	// At least one inference provider must be configured
	return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
}

function hasLangfuseVars(): boolean {
	return !!(process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_HOST);
}

// ============================================================================
// MOCK CF ENV
// ============================================================================

// Lazy-load DO classes to avoid pulling in CF worker runtime at import time
let _doClasses: { UserGateway: any; ChatStreamDO: any; ChatServices: any } | null = null;

async function getDOClasses() {
	if (!_doClasses) {
		const [ugModule, csModule, servicesModule] = await Promise.all([
			import('@/workers/objects/src/objects/user-gateway'),
			import('@/workers/objects/src/objects/chat-stream-do'),
			import('@/workers/services/src/index'),
		]);
		_doClasses = {
			UserGateway: ugModule.UserGateway,
			ChatStreamDO: csModule.ChatStreamDO,
			ChatServices: servicesModule.ChatServices,
		};
	}
	return _doClasses;
}

async function buildMockEnv(): Promise<Record<string, unknown>> {
	const env: Record<string, unknown> = {
		// Secrets (SecretsStoreSecret interface)
		ANTHROPIC_API_KEY: makeSecretMock(process.env.ANTHROPIC_API_KEY ?? ''),
		OPENROUTER_API_KEY: makeSecretMock(process.env.OPENROUTER_API_KEY ?? ''),
		OPENAI_KEY: makeSecretMock(process.env.OPENAI_API_KEY ?? ''),
		LANGFUSE_SECRET_KEY: makeSecretMock(process.env.LANGFUSE_SECRET_KEY ?? ''),
		DATABASE_URL: makeSecretMock(process.env.DATABASE_URL ?? ''),
		CLERK_SECRET_KEY: makeSecretMock('test-clerk-secret'),
		AUTH_SECRET: makeSecretMock('test-auth-secret'),
		FIRECRAWL_API_KEY: makeSecretMock(process.env.FIRECRAWL_API_KEY ?? ''),
		// Non-secrets
		LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY ?? '',
		LANGFUSE_HOST: process.env.LANGFUSE_HOST ?? '',
		LANGFUSE_ENVIRONMENT: process.env.LANGFUSE_ENVIRONMENT ?? 'production',
		CLERK_PUBLISHABLE_KEY: '',
		CHAT_OUTPUT_SAFETY_ENABLED: 'false', // disable safety checks in tests
		ENV: 'test',
		CORS_ALLOWED_ORIGIN: '*',
		// Queue mocks
		EMBEDDING_QUEUE: { send: () => Promise.resolve() },
		EXTRACTION_QUEUE: { send: () => Promise.resolve() },
		// Analytics Engine — no-op in tests
		STREAM_AE: { writeDataPoint: () => {} },
		WORKER_NAME: 'hi-chat-test',
		WORKER_NAME_FULL: 'hi-chat-test',
	};

	if (hasLangfuseVars()) {
		env.LANGFUSE_PROMPT_SERVICE = {
			async getPromptRaw(input: { promptName: string }) {
				const { getLangfusePromptRawRpc } = await import('@/workers/services/src/langfuse-service');
				return getLangfusePromptRawRpc(input, env as ServicesEnv);
			},
		};
	}

	// DO namespace mocks
	const { UserGateway, ChatStreamDO, ChatServices } = await getDOClasses();
	env.USER_GATEWAY = new MockDurableObjectNamespace(UserGateway, env);
	env.CHAT_STREAM_DO = new MockDurableObjectNamespace(ChatStreamDO, env);
	// ChatServices runs in-process for tests, sharing the same env (and thus
	// the same mocked UG / ChatStreamDO namespaces).
	env.CHAT_SERVICES = new ChatServices({}, env);

	return env;
}

// ============================================================================
// TEST SESSION
// ============================================================================

export interface TurnResult {
	userMessageId: string;
	agentMessageId: string;
	events: StreamEvent[];
}

export interface TestSessionOptions {
	/** Override chat handler options per-session */
	handlerOptions?: Partial<ChatHandlerOptions>;
}

/**
 * A multi-turn test session that exercises the real chatActionHandler.
 *
 * Usage:
 * ```ts
 * const session = await createTestSession();
 * const turn1 = await session.send('Hello, create a Genesis DNA');
 * expect(turn1.events.some(e => e.type === 'tool_start')).toBe(true);
 * ```
 */
export class TestSession {
	readonly chatId: string;
	readonly projectId: string;
	readonly userId: string;
	readonly preset: string;
	private ctx: Ctx;
	private options: TestSessionOptions;
	private turns: TurnResult[] = [];

	constructor(
		chatId: string,
		projectId: string,
		userId: string,
		ctx: Ctx,
		options: TestSessionOptions = {},
		preset?: string,
	) {
		this.chatId = chatId;
		this.projectId = projectId;
		this.userId = userId;
		this.ctx = ctx;
		this.options = options;
		this.preset = preset ?? process.env.TEST_PRESET ?? 'sonnet';
	}

	/** Default per-turn timeout (ms). Override per-call via `send(msg, { timeout })`. */
	static DEFAULT_TURN_TIMEOUT = 120_000;

	/** Build cache key interpolation vars from session config. */
	private getCacheKeyVars(): CacheKeyVars {
		const resolved = resolvePreset(this.preset);
		return {
			prompts: this.options.handlerOptions?.useLocalPrompts ? 'local' : 'lfuse',
			provider: resolved?.paramsType ?? 'unknown',
			preset: this.preset,
		};
	}

	/** Send a message and wait for the full generation to complete. */

	async send(message: string, opts?: { timeout?: number }): Promise<TurnResult> {
		const verbose = !!process.env.TEST_VERBOSE;
		const events: StreamEvent[] = [];
		const turnTimeout = opts?.timeout ?? TestSession.DEFAULT_TURN_TIMEOUT;

		if (verbose) {
			console.log(`\n[USER] ${message}`);
		}

		// Fork EntityManager for each turn (mimics worker behavior)
		const freshEm = (this.ctx as any).em.fork() as EntityManager;
		const turnCtx = { ...this.ctx, em: freshEm } as Ctx;

		const generation = async () => {
			const result = (await chatActionHandler(
				{ message, chatId: this.chatId, model: this.preset },
				turnCtx,
				{
					onEvent: (event) => {
						events.push(event);
						if (verbose) this.logEvent(event);
					},
					...this.options.handlerOptions,
				},
			)) as ChatActionResult;

			if (result.generation) {
				await result.generation;
			}

			return result;
		};

		const result = await Promise.race([
			generation(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`Turn timed out after ${turnTimeout}ms`)), turnTimeout),
			),
		]);

		const turn: TurnResult = {
			userMessageId: result.userMessageId ?? '',
			agentMessageId: result.agentMessageId,
			events,
		};
		this.turns.push(turn);
		return turn;
	}

	private logEvent(event: StreamEvent) {
		switch (event.type) {
			case 'delta':
				process.stdout.write(event.text);
				break;
			case 'tool_start':
				console.log(`\n[TOOL] ${event.tool}`);
				break;
			case 'tool_call_complete':
				console.log(`[TOOL INPUT] ${event.tool}: ${JSON.stringify(event.input)}`);
				break;
			case 'tool_result':
				console.log(`[TOOL RESULT] ${event.id} success=${event.success}${!event.success ? ` result=${event.result}` : ''}`);
				break;
			case 'error':
				console.log(`[ERROR] ${event.error}`);
				break;
			case 'done':
				console.log(`\n[DONE] outputType=${event.outputType ?? 'text'}`);
				break;
			default:
				break;
		}
	}

	/**
	 * Send a message with checkpoint caching support.
	 *
	 * - If TEST_CACHE_KEY is set and a checkpoint exists → restores from cache (skips inference)
	 * - If TEST_CACHE_KEY is set but no checkpoint → runs live, then saves checkpoint
	 * - If TEST_SKIP_CACHE=true → always runs live and overwrites checkpoint
	 * - If TEST_CACHE_KEY is not set → runs live (no caching)
	 */
	async sendCached(scenarioId: string, message: string, opts?: { timeout?: number }): Promise<TurnResult> {
		const cacheKey = getCacheKey(this.getCacheKeyVars());

		// No cache key → just run live
		if (!cacheKey) {
			return this.send(message, opts);
		}

		// Cache hit (and not skipping) → restore from checkpoint
		if (!shouldSkipCache() && hasCheckpoint(scenarioId, cacheKey)) {
			const em = (this.ctx as any).em.fork() as EntityManager;
			const cachedTurns = await loadCheckpoint(scenarioId, cacheKey, this.chatId, this.projectId, em);

			if (process.env.TEST_VERBOSE) {
				console.log(`[CACHE HIT] ${scenarioId}.${cacheKey} — restored ${cachedTurns.length} turn(s)`);
			}

			// Add all cached turns to session
			for (const turn of cachedTurns) {
				this.turns.push(turn);
			}

			// Return the last cached turn
			return cachedTurns[cachedTurns.length - 1]!;
		}

		// Cache miss or skip → run live
		if (process.env.TEST_VERBOSE) {
			console.log(`[CACHE MISS] ${scenarioId}.${cacheKey} — running live`);
		}

		const turnsBefore = this.turns.length;
		const turn = await this.send(message, opts);

		// Save checkpoint with all turns from this sendCached call
		const newTurns = this.turns.slice(turnsBefore);
		const em = (this.ctx as any).em.fork() as EntityManager;
		await saveCheckpoint(scenarioId, cacheKey, this.preset, this.chatId, em, newTurns);

		if (process.env.TEST_VERBOSE) {
			console.log(`[CACHE SAVED] ${scenarioId}.${cacheKey}`);
		}

		return turn;
	}

	/** Get all turns so far. */
	getTurns(): TurnResult[] {
		return [...this.turns];
	}

	/** Get the last turn result. */
	getLastTurn(): TurnResult | undefined {
		return this.turns[this.turns.length - 1];
	}
}

// ============================================================================
// FACTORY
// ============================================================================

const TEST_CLERK_ID = 'test-user-chat-harness';

export interface CreateSessionOptions extends TestSessionOptions {
	/** Phase name for the chat entity (default: 'discovery') */
	phase?: string;
	/** Override preset ID (default: env TEST_PRESET or 'sonnet') */
	preset?: string;
}

/**
 * Create a test session with seeded DB entities and a fully wired Ctx.
 * Call `teardownTestSession()` in afterAll.
 */
export async function createTestSession(options: CreateSessionOptions = {}): Promise<TestSession> {
	// Clear stale data from previous runs (e.g. aborted tests)
	await clearDatabase();

	const em = await getTestEm();

	// Seed entities
	const user = em.create(UserEntity, {
		email: 'test@hyperintel.test',
		emailConfirmed: true,
		clerkId: TEST_CLERK_ID,
	});
	const project = em.create(ProjectEntity, {
		name: 'Test Project',
		user,
	});
	const chat = em.create(ChatEntity, {
		phase: options.phase ?? 'discovery',
		phase_index: 0,
		project,
	});
	await em.persistAndFlush([user, project, chat]);

	// Build Ctx
	const mockEnv = await buildMockEnv();

	const useLocalPrompts = hasLangfuseVars() ? undefined : true;

	const ctx = {
		user: { userId: TEST_CLERK_ID },
		env: mockEnv,
		em,
		anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
		openai: process.env.OPENAI_API_KEY
			? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
			: undefined,
		orouterSdk: process.env.OPENROUTER_API_KEY
			? new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
			: undefined,
		previewAlias: null,
	} as unknown as Ctx;

	// Default handler options: use local prompts when Langfuse vars aren't available
	const mergedOptions: CreateSessionOptions = {
		...options,
		handlerOptions: {
			...options.handlerOptions,
			...(useLocalPrompts && !options.handlerOptions?.useLocalPrompts
				? { useLocalPrompts: true }
				: {}),
		},
	};

	return new TestSession(chat.id, project.id, user.id, ctx, mergedOptions, options.preset);
}

/**
 * Cleanup: truncate all tables and close ORM.
 * Call in afterAll of your test suite.
 */
export async function teardownTestSession() {
	await clearDatabase();
	await closeTestOrm();
}

export { clearDatabase, closeTestOrm, getTestEm, getTestOrm };
