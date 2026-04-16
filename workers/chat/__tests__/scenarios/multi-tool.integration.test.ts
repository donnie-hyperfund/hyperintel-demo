/**
 * Integration test: Multi-tool sequencing.
 *
 * Tests that the model correctly chains multiple tool types in a single turn,
 * e.g. searching knowledge before creating a document.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSession, teardownTestSession, canRunChatTests } from '../harness';
import {
	expectTurnOk,
	toolWasCalled,
	getToolSequence,
	getDoneEvent,
	documentWasCreated,
} from '../helpers';
import type { TestSession } from '../harness';

describe.skipIf(!canRunChatTests())('Chat handler: multi-tool sequencing', () => {
	let session: TestSession;

	beforeAll(async () => {
		session = await createTestSession({ phase: 'discovery' });
	});

	afterAll(async () => {
		await teardownTestSession();
	});

	it('searches knowledge then creates a document based on findings', async () => {
		// Create some knowledge to search (cached)
		const setupTurn = await session.sendCached(
			'multi-tool/setup',
			'Please create a short research report document called "market-overview" about AI trends in 2026. Keep it brief — just 3-4 paragraphs.',
		);
		expectTurnOk('multi-tool-setup', setupTurn);

		// Approve so it's searchable via knowledge
		const approveTurn = await session.send('Approve the market-overview.');
		expectTurnOk('multi-tool-approve', approveTurn);

		// Now ask to search and create based on findings
		const turn = await session.send(
			'Search our knowledge base for information about AI trends, then create a new internal document called "executive-brief" that summarizes the key findings in 1-2 paragraphs.',
		);
		expectTurnOk('multi-tool', turn);

		const seq = getToolSequence(turn);

		// Should have searched first
		expect(toolWasCalled(turn, 'search_knowledge')).toBe(true);

		// Then created a document
		expect(toolWasCalled(turn, 'begin_document')).toBe(true);
		expect(toolWasCalled(turn, 'finalize_document')).toBe(true);
		expect(documentWasCreated(turn)).toBe(true);

		// Search should come before document creation
		const searchIdx = seq.indexOf('search_knowledge');
		const beginIdx = seq.indexOf('begin_document');
		expect(searchIdx).toBeLessThan(beginIdx);

		const done = getDoneEvent(turn);
		expect(done?.outputType ?? 'text').toBe('text');
	}, 240_000);
});
