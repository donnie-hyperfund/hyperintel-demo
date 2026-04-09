/**
 * Integration test: Document discovery and metadata.
 *
 * Tests list_documents, read_document, and document creation with specific metadata.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSession, teardownTestSession, canRunChatTests } from '../harness';
import {
	expectTurnOk,
	toolWasCalled,
	getToolInput,
	getToolSequence,
	getDoneEvent,
} from '../helpers';
import type { TestSession } from '../harness';

describe.skipIf(!canRunChatTests())('Chat handler: document discovery', () => {
	let session: TestSession;

	beforeAll(async () => {
		session = await createTestSession({ phase: 'discovery' });
	});

	afterAll(async () => {
		await teardownTestSession();
	});

	it('lists documents when asked', async () => {
		// Create a document first (cached)
		const setupTurn = await session.sendCached(
			'discovery/setup',
			'Please create a short research report document called "market-overview" about AI trends in 2026. Keep it brief — just 3-4 paragraphs.',
		);
		expectTurnOk('discovery-setup', setupTurn);

		// Ask what documents exist
		const listTurn = await session.send('What documents do we have so far?');
		expectTurnOk('discovery-list', listTurn);

		expect(toolWasCalled(listTurn, 'list_documents')).toBe(true);

		const done = getDoneEvent(listTurn);
		expect(done?.outputType ?? 'text').toBe('text');
	}, 120_000);

	it('reads a specific document by name', async () => {
		// Relies on the document created in the previous test (same session)
		const readTurn = await session.send('Show me the contents of market-overview.');
		expectTurnOk('discovery-read', readTurn);

		expect(toolWasCalled(readTurn, 'read_document')).toBe(true);

		const input = getToolInput(readTurn, 'read_document');
		expect(input?.name).toContain('market-overview');

		const done = getDoneEvent(readTurn);
		expect(done?.outputType ?? 'text').toBe('text');
	}, 120_000);

	it('creates a document with specific metadata', async () => {
		const turn = await session.send(
			'Create an internal document called "team-spec" with document type "Agent Team Specification". Just write a one-paragraph placeholder about the team structure.',
		);
		expectTurnOk('discovery-metadata', turn);

		expect(toolWasCalled(turn, 'begin_document')).toBe(true);
		expect(toolWasCalled(turn, 'finalize_document')).toBe(true);

		const input = getToolInput(turn, 'begin_document');
		expect(input?.name).toContain('team-spec');
		expect(input?.is_internal).toBe(true);
		expect(typeof input?.document_type).toBe('string');
		expect((input?.document_type as string).toLowerCase()).toContain('team specification');

		const seq = getToolSequence(turn);
		const beginIdx = seq.indexOf('begin_document');
		const finalizeIdx = seq.indexOf('finalize_document');
		expect(beginIdx).toBeLessThan(finalizeIdx);
	}, 120_000);
});
