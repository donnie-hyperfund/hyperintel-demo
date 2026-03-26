/**
 * Agentic loop integration tests for document tools.
 *
 * Uses real Anthropic Sonnet inference + in-memory document tools (no DB).
 * Tests that the LLM correctly calls tools in multi-step document workflows.
 *
 * Requires ANTHROPIC_API_KEY in .env.test
 *
 * Run with: pnpm vitest run --config workers/chat/vitest.config.ts agent-tools.integration
 */
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(import.meta.dirname, '../../../../../.env.test'), override: true });

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { OpenRouter } from '@openrouter/sdk';
import { z } from 'zod';

import { runAgentStream } from '@common/ai/agent';
import type { AgentTool, AgentStreamEvent } from '@common/ai/agent';
import { AIParamsType } from '@common/ai/inference';
import type { Ctx } from '@common/ai/types';
import { DraftManager } from './draft-manager';
import { applyEdits, countLines, extractViewport, type EditOperation } from './document-service';

// ============================================================================
// CONFIG
// ============================================================================

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

// ============================================================================
// IN-MEMORY DOCUMENT STORE (replaces DB)
// ============================================================================

interface StoredDocument {
	name: string;
	title: string;
	content: string;
	version: number;
	status: 'proposed' | 'approved' | 'rejected' | 'deleted';
	is_internal: boolean;
	document_type: string;
}

class InMemoryDocumentStore {
	docs = new Map<string, StoredDocument>();

	upsert(name: string, title: string, content: string, is_internal: boolean, document_type: string) {
		const existing = this.docs.get(name);
		const version = existing ? existing.version + 1 : 1;
		// If there's an existing proposed, supersede it
		if (existing?.status === 'proposed') {
			existing.status = 'approved'; // simplified
		}
		this.docs.set(name, { name, title, content, version, status: 'proposed', is_internal, document_type });
		return { versionId: `v-${name}-${version}`, version, action: existing ? 'updated' : 'created', lines: countLines(content) };
	}

	find(name: string): StoredDocument | null {
		return this.docs.get(name) ?? null;
	}

	list(search?: string): StoredDocument[] {
		const all = [...this.docs.values()].filter(d => d.status !== 'deleted');
		if (!search) return all;
		const q = search.toLowerCase();
		return all.filter(d => d.name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q));
	}

	delete(name: string): boolean {
		const doc = this.docs.get(name);
		if (!doc) return false;
		doc.status = 'deleted';
		return true;
	}
}

// ============================================================================
// TEST TOOL DEFINITIONS (mirror production schemas, in-memory executors)
// ============================================================================

const DocumentTypeSchema = z.enum([
	'Genesis DNA', 'Legacy DNA', 'Team Specification', 'MID', 'PSEB',
	'Action Plan', 'Completion Brief', 'Company Profile', 'Human Persona',
	'Research Report', 'Executive Summary', 'Other',
]);

function normalizeKey(name: string): string {
	const trimmed = name.trim();
	return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

interface TestToolCtx {
	store: InMemoryDocumentStore;
	draftManager: DraftManager;
}

function createTestDocumentTools(store: InMemoryDocumentStore, draftManager: DraftManager) {
	const ctx: TestToolCtx = { store, draftManager };

	const beginDoc: AgentTool<'begin_document', any, TestToolCtx> = {
		name: 'begin_document',
		description: 'Start a document editing draft session. Modes: "create" (new doc), "edit" (modify existing). MUST call finalize_document when done.',
		parameters: z.object({
			mode: z.enum(['create', 'edit']),
			name: z.string().min(1).describe('Document name'),
			title: z.string().optional().nullable().describe('Display title'),
			is_internal: z.boolean().default(true),
			document_type: DocumentTypeSchema,
		}),
		executor: (input) => {
			const name = normalizeKey(input.name);
			const existing = store.find(name);

			if (input.mode === 'create' && existing && existing.status !== 'deleted') {
				return { error: `Document "${name}" already exists. Use mode="edit".` };
			}
			if (input.mode === 'edit' && !existing) {
				return { error: `Document "${name}" does not exist. Use mode="create".` };
			}

			try {
				const initialContent = input.mode === 'edit' && existing ? existing.content : '';
				const draft = draftManager.begin(
					'test-scope', name, input.title || name, input.mode,
					initialContent, existing?.version, input.is_internal, input.document_type,
				);
				return {
					status: 'editing', mode: input.mode, name, title: draft.title,
					is_internal: draft.is_internal, document_type: draft.document_type,
					lines: countLines(draft.content),
					message: input.mode === 'create'
						? 'Draft started. Use write_document to add content, then finalize_document.'
						: `Editing from v${existing?.version}. Make changes, then finalize_document.`,
				};
			} catch (err: any) {
				return { error: err.message };
			}
		},
	};

	const writeDoc: AgentTool<'write_document', any, TestToolCtx> = {
		name: 'write_document',
		description: 'Append content to the current editing draft.',
		parameters: z.object({ content: z.string() }),
		executor: (input) => {
			try {
				const draft = draftManager.append(input.content);
				return { status: 'written', charsAdded: input.content.length, totalLines: countLines(draft.content) };
			} catch (err: any) {
				return { error: err.message };
			}
		},
	};

	const patchDoc: AgentTool<'patch_document', any, TestToolCtx> = {
		name: 'patch_document',
		description: 'Make precise edits to the current draft. Batch multiple edits into one call.',
		parameters: z.object({
			edits: z.array(z.object({
				startLine: z.number().int().positive(),
				endLine: z.number().int().positive(),
				oldContent: z.string(),
				newContent: z.string(),
			})).min(1),
		}),
		executor: (input) => {
			try {
				const draft = draftManager.requireCurrent();
				const editOps: EditOperation[] = input.edits.map(e => ({
					startLine: e.startLine, endLine: e.endLine, oldContent: e.oldContent, newContent: e.newContent,
				}));
				const result = applyEdits(draft.content, editOps);
				if (!result.success) return { error: result.error };
				draftManager.setContent(result.newContent!);
				return { status: 'edited', editsApplied: input.edits.length, linesNow: result.linesNow };
			} catch (err: any) {
				return { error: err.message };
			}
		},
	};

	const finalizeDoc: AgentTool<'finalize_document', any, TestToolCtx> = {
		name: 'finalize_document',
		description: 'Save the current editing draft as a proposed version. MUST call after begin_document.',
		parameters: z.object({}),
		executor: () => {
			try {
				const draft = draftManager.requireCurrent();
				const result = store.upsert(draft.name, draft.title, draft.content, draft.is_internal, draft.document_type);
				draftManager.discard();
				return {
					result: { action: result.action, name: draft.name, version: result.version, status: 'proposed', lines: result.lines },
					message: `Saved as proposed v${result.version}. Awaiting user approval.`,
				};
			} catch (err: any) {
				return { error: err.message };
			}
		},
	};

	const readDoc: AgentTool<'read_document', any, TestToolCtx> = {
		name: 'read_document',
		description: 'View document content.',
		parameters: z.object({
			name: z.string().min(1),
			version: z.enum(['approved', 'proposed', 'latest']).default('latest'),
			startLine: z.number().int().positive().optional().nullable(),
			endLine: z.number().int().positive().optional().nullable(),
		}),
		executor: (input) => {
			const name = normalizeKey(input.name);

			// Check active draft first
			const draft = draftManager.getCurrent();
			if (draft && draft.name === name) {
				const viewport = extractViewport(draft.content, input.startLine ?? undefined, input.endLine ?? undefined);
				return { source: 'editing_draft', name, totalLines: viewport.totalLines, content: viewport.content };
			}

			const doc = store.find(name);
			if (!doc) return { error: `Document "${name}" not found.` };
			const viewport = extractViewport(doc.content, input.startLine ?? undefined, input.endLine ?? undefined);
			return { source: doc.status, name, version: doc.version, totalLines: viewport.totalLines, content: viewport.content };
		},
	};

	const listDocs: AgentTool<'list_documents', any, TestToolCtx> = {
		name: 'list_documents',
		description: 'List all documents with status info.',
		parameters: z.object({ search: z.string().optional().nullable() }),
		executor: (input) => {
			const docs = store.list(input.search ?? undefined);
			return {
				documents: docs.map(d => ({
					name: d.name, title: d.title, lines: countLines(d.content),
					latestVersion: d.version, latestStatus: d.status,
				})),
			};
		},
	};

	const deleteDoc: AgentTool<'delete_document', any, TestToolCtx> = {
		name: 'delete_document',
		description: 'Delete a document by name.',
		parameters: z.object({ name: z.string().min(1).describe('Document name to delete.') }),
		executor: (input) => {
			const name = normalizeKey(input.name);
			const deleted = store.delete(name);
			if (!deleted) return { error: `Document "${name}" not found.` };
			return { status: 'deleted', name, message: `Document "${name}" has been deleted.` };
		},
	};

	const searchKnowledge: AgentTool<'search_knowledge', any, TestToolCtx> = {
		name: 'search_knowledge',
		description: 'Search knowledge base using semantic similarity across documents.',
		parameters: z.object({
			query: z.string().describe('Natural language query'),
			limit: z.number().int().min(1).max(20).default(5),
		}),
		executor: (input) => {
			// Simple keyword search as stand-in for semantic search
			const query = input.query.toLowerCase();
			const results = store.list().filter(d =>
				d.content.toLowerCase().includes(query) || d.title.toLowerCase().includes(query),
			);
			if (results.length === 0) return 'No relevant documents found.';
			return results.map(d => `## ${d.title} (${d.name})\n${d.content.slice(0, 500)}`).join('\n\n---\n\n');
		},
	};

	return [beginDoc, writeDoc, patchDoc, finalizeDoc, readDoc, listDocs, deleteDoc, searchKnowledge] as const;
}

// ============================================================================
// HELPERS
// ============================================================================

let eCtx: Ctx;

function baseInput(userMessage: string) {
	return {
		paramsType: AIParamsType.Anthropic as const,
		params: { model: MODEL, thinking: false } as const,
		instructions: `You are a document management assistant. You have tools to create, edit, read, list, delete, and search documents.
Always use the tools to complete document tasks. Be concise in your responses.
When creating documents, use document_type "Other" unless told otherwise.
When asked to create a document, use begin_document → write_document → finalize_document.
When asked to edit, use begin_document(mode="edit") → patch_document or write_document → finalize_document.`,
		context: [{ role: 'user' as const, content: userMessage }],
		maxTokens: 4096,
		contentThreshold: 0,
	};
}

async function collectStream(stream: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
	const events: AgentStreamEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function getToolCalls(events: AgentStreamEvent[]): Array<{ tool: string; input: any }> {
	return events
		.filter((e): e is Extract<AgentStreamEvent, { type: 'tool_call_complete' }> => e.type === 'tool_call_complete')
		.map(e => ({ tool: e.tool, input: e.input }));
}

function getToolResults(events: AgentStreamEvent[]) {
	return events.filter((e): e is Extract<AgentStreamEvent, { type: 'tool_result' }> => e.type === 'tool_result');
}

function hasFatalError(events: AgentStreamEvent[]): boolean {
	return events.some(e => e.type === 'error' && !(e as any).soft);
}

function getDoneEvent(events: AgentStreamEvent[]) {
	return events.find((e): e is Extract<AgentStreamEvent, { type: 'done' }> => e.type === 'done');
}

// ============================================================================
// TESTS
// ============================================================================

describe.skipIf(!API_KEY)('Agent document tools (real inference)', () => {
	let store: InMemoryDocumentStore;
	let draftManager: DraftManager;
	let tools: ReturnType<typeof createTestDocumentTools>;

	beforeAll(() => {
		eCtx = {
			anthropic: new Anthropic({ apiKey: API_KEY }),
			openai: new OpenAI({ apiKey: 'unused' }),
			orouterSdk: new OpenRouter({ apiKey: 'unused' }),
		};
	});

	beforeEach(() => {
		store = new InMemoryDocumentStore();
		draftManager = new DraftManager();
		tools = createTestDocumentTools(store, draftManager);
	});

	it('creates a document: begin → write → finalize', async () => {
		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Create a document called "test-report" with title "Test Report". Write a short paragraph about software testing.'),
			tools,
			{ config: { maxToolCalls: 10 } },
		);

		const events = await collectStream(stream);
		const toolCalls = getToolCalls(events);
		const toolResults = getToolResults(events);

		expect(hasFatalError(events)).toBe(false);
		expect(getDoneEvent(events)).toBeDefined();

		// Should have called begin, write, finalize in order
		const toolNames = toolCalls.map(tc => tc.tool);
		expect(toolNames).toContain('begin_document');
		expect(toolNames).toContain('write_document');
		expect(toolNames).toContain('finalize_document');

		// begin should come before write, write before finalize
		const beginIdx = toolNames.indexOf('begin_document');
		const writeIdx = toolNames.indexOf('write_document');
		const finalizeIdx = toolNames.indexOf('finalize_document');
		expect(beginIdx).toBeLessThan(writeIdx);
		expect(writeIdx).toBeLessThan(finalizeIdx);

		// All tool results should be successful
		expect(toolResults.every(r => r.success)).toBe(true);

		// Document should exist in store
		const doc = store.find('test-report.md');
		expect(doc).not.toBeNull();
		expect(doc!.status).toBe('proposed');
		expect(doc!.content.length).toBeGreaterThan(0);

		// Draft should be cleared
		expect(draftManager.hasActive()).toBe(false);
	}, 60_000);

	it('edits an existing document with patch_document', async () => {
		// Seed a document
		store.upsert('report.md', 'Report', 'Line 1: Introduction\nLine 2: This is the old content.\nLine 3: Conclusion', false, 'Other');

		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Edit the document "report" — change "old content" on line 2 to "updated content".'),
			tools,
			{ config: { maxToolCalls: 10 } },
		);

		const events = await collectStream(stream);
		const toolCalls = getToolCalls(events);

		expect(hasFatalError(events)).toBe(false);

		const toolNames = toolCalls.map(tc => tc.tool);
		expect(toolNames).toContain('begin_document');
		expect(toolNames).toContain('finalize_document');

		// Should use patch_document (or write_document for full rewrite — either is acceptable)
		const usedPatchOrWrite = toolNames.includes('patch_document') || toolNames.includes('write_document');
		expect(usedPatchOrWrite).toBe(true);

		// Document should be updated in store
		const doc = store.find('report.md');
		expect(doc).not.toBeNull();
		expect(doc!.content).toContain('updated content');
		expect(doc!.content).not.toContain('old content');
		expect(doc!.version).toBe(2);
	}, 60_000);

	it('deletes a document', async () => {
		// Seed a document
		store.upsert('obsolete.md', 'Obsolete Doc', 'This should be deleted.', true, 'Other');

		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Delete the document called "obsolete".'),
			tools,
			{ config: { maxToolCalls: 5 } },
		);

		const events = await collectStream(stream);
		const toolCalls = getToolCalls(events);

		expect(hasFatalError(events)).toBe(false);
		expect(getDoneEvent(events)).toBeDefined();

		// Should have called delete_document
		expect(toolCalls.map(tc => tc.tool)).toContain('delete_document');

		// Document should be marked as deleted
		const doc = store.docs.get('obsolete.md');
		expect(doc).toBeDefined();
		expect(doc!.status).toBe('deleted');
	}, 60_000);

	it('searches documents via search_knowledge', async () => {
		// Seed some documents
		store.upsert('market-analysis.md', 'Market Analysis', 'The fintech market grew 25% in Q3. Key players include Stripe and Square.', false, 'Research Report');
		store.upsert('team-plan.md', 'Team Plan', 'Engineering team will focus on API development.', true, 'Other');

		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Search for documents related to "fintech market growth".'),
			tools,
			{ config: { maxToolCalls: 5 } },
		);

		const events = await collectStream(stream);
		const toolCalls = getToolCalls(events);

		expect(hasFatalError(events)).toBe(false);
		expect(getDoneEvent(events)).toBeDefined();

		// Should have called search_knowledge
		expect(toolCalls.map(tc => tc.tool)).toContain('search_knowledge');
	}, 60_000);

	it('handles multi-step edit with read then patch', async () => {
		// Seed a longer document
		const content = [
			'# Project Plan',
			'',
			'## Phase 1: Research',
			'Conduct market research and competitor analysis.',
			'',
			'## Phase 2: Development',
			'Build the MVP with core features.',
			'',
			'## Phase 3: Launch',
			'Deploy to production and monitor.',
		].join('\n');
		store.upsert('plan.md', 'Project Plan', content, false, 'Other');

		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Edit the "plan" document. In Phase 2, change "Build the MVP with core features." to "Build the MVP with core features and integrations." Also in Phase 3, change "Deploy to production and monitor." to "Deploy to production, monitor, and gather feedback."'),
			tools,
			{ config: { maxToolCalls: 15 } },
		);

		const events = await collectStream(stream);

		expect(hasFatalError(events)).toBe(false);
		expect(getDoneEvent(events)).toBeDefined();

		// Document should have both changes applied
		const doc = store.find('plan.md');
		expect(doc).not.toBeNull();
		expect(doc!.content).toContain('core features and integrations');
		expect(doc!.content).toContain('gather feedback');
		expect(draftManager.hasActive()).toBe(false);
	}, 90_000);

	it('does not call non-existent tools or enter infinite loops', async () => {
		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Create a short document called "quick-note" with just "Hello world" as content.'),
			tools,
			{ config: { maxToolCalls: 15 } },
		);

		const events = await collectStream(stream);
		const toolCalls = getToolCalls(events);

		expect(hasFatalError(events)).toBe(false);
		expect(getDoneEvent(events)).toBeDefined();

		// All called tools should be from our defined set
		const validToolNames = new Set(tools.map(t => t.name));
		for (const tc of toolCalls) {
			expect(validToolNames.has(tc.tool)).toBe(true);
		}

		// Should not make an excessive number of calls for a simple task
		expect(toolCalls.length).toBeLessThanOrEqual(6);
	}, 60_000);

	it('all tool results have success status (no broken tool calls)', async () => {
		const { stream } = runAgentStream(
			{ store, draftManager }, eCtx,
			baseInput('Create a document named "checklist" with title "QA Checklist" and write a 3-item checklist about code review.'),
			tools,
			{ config: { maxToolCalls: 10 } },
		);

		const events = await collectStream(stream);
		const toolResults = getToolResults(events);

		expect(hasFatalError(events)).toBe(false);
		expect(toolResults.length).toBeGreaterThanOrEqual(3); // at least begin, write, finalize
		expect(toolResults.every(r => r.success)).toBe(true);
	}, 60_000);
});
