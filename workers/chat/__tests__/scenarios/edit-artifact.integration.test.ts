/**
 * Integration test: Document editing through the real chat handler.
 *
 * Uses a cached checkpoint for the initial document creation,
 * then tests editing that document with live inference.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSession, teardownTestSession, canRunChatTests } from '../harness';
import {
	turnCompletedOk,
	toolWasCalled,
	allToolsSucceeded,
	getToolSequence,
	getDoneEvent,
	summarizeTurn,
} from '../helpers';
import type { TestSession } from '../harness';

describe.skipIf(!canRunChatTests())('Chat handler: document editing', () => {
	let session: TestSession;

	beforeAll(async () => {
		session = await createTestSession({ phase: 'discovery' });
	});

	afterAll(async () => {
		await teardownTestSession();
	});

	it('edits an existing document', async () => {
		// Step 1: Create the document (cached when TEST_CACHE_KEY is set)
		const createTurn = await session.sendCached(
			'edit-artifact/setup',
			'Please create a short research report document called "market-overview" about AI trends in 2026. Keep it brief — just 3-4 paragraphs.',
		);
		expect(turnCompletedOk(createTurn)).toBe(true);

		// Step 2: Edit the document (always live — this is what we're testing)
		const editTurn = await session.send(
			'Edit the market-overview document to add a new section at the end about the impact of AI on robotics in manufacturing.',
		);

		console.log(summarizeTurn(editTurn));

		expect(turnCompletedOk(editTurn)).toBe(true);

		// Should have used edit-related document tools
		const seq = getToolSequence(editTurn);
		const usedEdit = seq.some((t) => ['edit_document', 'patch_document', 'write_document'].includes(t));
		expect(usedEdit).toBe(true);

		expect(allToolsSucceeded(editTurn)).toBe(true);

		const done = getDoneEvent(editTurn);
		expect(done?.outputType ?? 'text').toBe('text');
	}, 180_000);
});
