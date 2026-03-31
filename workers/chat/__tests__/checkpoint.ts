/**
 * Checkpoint system for caching conversation state between test runs.
 *
 * Saves/restores DB state (messages, artifacts, chat metadata) and TurnResult events
 * so expensive inference turns can be replayed from cache.
 *
 * Env vars:
 *   TEST_CACHE_KEY  — cache namespace (e.g. 'v1'). Required to enable caching.
 *   TEST_SKIP_CACHE — set to 'true' to force live inference and overwrite existing cache.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';

import { ChatMessageEntity } from '@/lib/orm/entities/chats/chat-message.entity';
import { ArtifactEntity } from '@/lib/orm/entities/artifacts/artifact.entity';
import { ArtifactVersionEntity } from '@/lib/orm/entities/artifacts/artifact-version.entity';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';

import type { StreamEvent } from '@/lib/schema/stream';
import type { TurnResult } from './harness';

// ============================================================================
// TYPES
// ============================================================================

interface CheckpointMessage {
	role: string;
	content: string;
	reasoning?: string | null;
	blocks?: unknown[] | null;
	metadata?: Record<string, unknown> | null;
	is_error?: boolean;
	is_aborted?: boolean;
}

interface CheckpointArtifact {
	key: string;
	title: string;
	version: number;
	metadata?: Record<string, unknown> | null;
	versions: {
		version: number;
		content?: string;
		ai_content?: string;
		status: string;
		is_internal: boolean;
		document_type: string;
	}[];
}

interface CheckpointData {
	/** Cache key used to create this checkpoint */
	cacheKey: string;
	/** When this checkpoint was created */
	createdAt: string;
	/** Preset used during generation (informational only, not used for cache matching) */
	generatedWith: string;
	/** Chat entity state */
	chat: {
		phase: string;
		phase_index: number;
		metadata?: Record<string, unknown> | null;
		token_usage?: unknown;
		summary?: string | null;
	};
	/** Ordered messages (user + assistant) */
	messages: CheckpointMessage[];
	/** Artifacts created during the cached turns */
	artifacts: CheckpointArtifact[];
	/** TurnResults with events for assertion replay */
	turns: TurnResult[];
}

// ============================================================================
// CONFIG
// ============================================================================

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures');

export function getCacheKey(): string | null {
	return process.env.TEST_CACHE_KEY || null;
}

export function shouldSkipCache(): boolean {
	return process.env.TEST_SKIP_CACHE === 'true';
}

function checkpointPath(scenarioId: string, cacheKey: string): string {
	return path.join(FIXTURES_DIR, cacheKey, `${scenarioId}.ckpt.json`);
}

// ============================================================================
// EVENT COMPACTION
// ============================================================================

/** Event types worth keeping in checkpoints (for assertion replay). */
const KEPT_EVENT_TYPES = new Set<StreamEvent['type']>([
	'tool_start',
	'tool_result',
	'document_start',
	'document_complete',
	'error',
	'done',
]);

/** Strip streaming deltas — keep only structural events needed for assertions. */
function compactTurn(turn: TurnResult): TurnResult {
	return {
		...turn,
		events: turn.events.filter((e) => KEPT_EVENT_TYPES.has(e.type)),
	};
}

// ============================================================================
// SAVE
// ============================================================================

/**
 * Snapshot current DB state and turn results into a checkpoint file.
 */
export async function saveCheckpoint(
	scenarioId: string,
	cacheKey: string,
	preset: string,
	chatId: string,
	em: EntityManager,
	turns: TurnResult[],
): Promise<void> {
	// Load chat
	const chat = await em.findOneOrFail(ChatEntity, { id: chatId });

	// Load messages in order
	const dbMessages = await em.find(
		ChatMessageEntity,
		{ chat: chatId },
		{ orderBy: { created_at: 'ASC' } },
	);

	const messages: CheckpointMessage[] = dbMessages.map((m) => ({
		role: m.role,
		content: m.content,
		...(m.reasoning && { reasoning: m.reasoning }),
		...(m.blocks && { blocks: m.blocks }),
		...(m.metadata && { metadata: m.metadata }),
		...(m.is_error && { is_error: true }),
		...(m.is_aborted && { is_aborted: true }),
	}));

	// Load artifacts + versions
	const dbArtifacts = await em.find(ArtifactEntity, { project: chat.project });
	const artifacts: CheckpointArtifact[] = [];

	for (const artifact of dbArtifacts) {
		const versions = await em.find(
			ArtifactVersionEntity,
			{ artifact: artifact.id },
			{ orderBy: { version: 'ASC' } },
		);
		artifacts.push({
			key: artifact.key,
			title: artifact.title,
			version: artifact.version,
			...(artifact.metadata && { metadata: artifact.metadata }),
			versions: versions.map((v) => ({
				version: v.version,
				...(v.content && { content: v.content }),
				...(v.ai_content && { ai_content: v.ai_content }),
				status: v.status,
				is_internal: v.is_internal,
				document_type: v.document_type,
			})),
		});
	}

	const data: CheckpointData = {
		cacheKey,
		createdAt: new Date().toISOString(),
		generatedWith: preset,
		chat: {
			phase: chat.phase,
			phase_index: chat.phase_index,
			...(chat.metadata && { metadata: chat.metadata }),
			...(chat.token_usage && { token_usage: chat.token_usage }),
			...(chat.summary && { summary: chat.summary }),
		},
		messages,
		artifacts,
		turns: turns.map(compactTurn),
	};

	const filePath = checkpointPath(scenarioId, cacheKey);
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// LOAD
// ============================================================================

/**
 * Check if a checkpoint exists for the given scenario + cache key.
 */
export function hasCheckpoint(scenarioId: string, cacheKey: string): boolean {
	return fs.existsSync(checkpointPath(scenarioId, cacheKey));
}

/**
 * Load checkpoint and restore DB state. Returns cached TurnResults.
 */
export async function loadCheckpoint(
	scenarioId: string,
	cacheKey: string,
	chatId: string,
	projectId: string,
	em: EntityManager,
): Promise<TurnResult[]> {
	const filePath = checkpointPath(scenarioId, cacheKey);
	const raw = fs.readFileSync(filePath, 'utf-8');
	const data: CheckpointData = JSON.parse(raw);

	// Restore chat metadata
	const chat = await em.findOneOrFail(ChatEntity, { id: chatId });
	chat.phase = data.chat.phase;
	chat.phase_index = data.chat.phase_index;
	if (data.chat.metadata) chat.metadata = data.chat.metadata;
	if (data.chat.token_usage) chat.token_usage = data.chat.token_usage as any;
	if (data.chat.summary) chat.summary = data.chat.summary;

	// Restore messages
	for (const msg of data.messages) {
		em.create(ChatMessageEntity, {
			chat: chatId,
			role: msg.role,
			content: msg.content,
			...(msg.reasoning && { reasoning: msg.reasoning }),
			...(msg.blocks && { blocks: msg.blocks }),
			...(msg.metadata && { metadata: msg.metadata }),
			...(msg.is_error && { is_error: true }),
			...(msg.is_aborted && { is_aborted: true }),
		});
	}

	// Restore artifacts + versions
	for (const art of data.artifacts) {
		const artifact = em.create(ArtifactEntity, {
			key: art.key,
			title: art.title,
			version: art.version,
			project: projectId,
			...(art.metadata && { metadata: art.metadata }),
		});

		for (const ver of art.versions) {
			em.create(ArtifactVersionEntity, {
				artifact,
				chat: chatId,
				version: ver.version,
				...(ver.content && { content: ver.content }),
				...(ver.ai_content && { ai_content: ver.ai_content }),
				status: ver.status as any,
				is_internal: ver.is_internal,
				document_type: ver.document_type as any,
			});
		}
	}

	await em.flush();

	return data.turns;
}
