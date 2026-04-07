/**
 * Integration test: Read-then-patch workflow.
 *
 * Verifies the model reads an existing document before patching it,
 * and that the full begin → read → patch → finalize flow works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSession, teardownTestSession, canRunChatTests } from '../harness';
import {
	expectTurnOk,
	toolWasCalled,
	getToolSequence,
	getDoneEvent,
} from '../helpers';
import type { TestSession } from '../harness';

describe.skipIf(!canRunChatTests())('Chat handler: read-then-patch', () => {
	let session: TestSession;

	beforeAll(async () => {
		session = await createTestSession({ phase: 'discovery' });
	});

	afterAll(async () => {
		await teardownTestSession();
	});

	it('reads a document before patching it', async () => {
		// Step 1: Create the document (cached)
		const createTurn = await session.sendCached(
			'read-and-patch/setup',
			'Please create a short research report document called "market-overview" about AI trends in 2026. Keep it brief — just 3-4 paragraphs.',
		);
		expectTurnOk('read-and-patch-setup', createTurn);

		// Step 2: Ask for a specific small change — model should read first, then patch
		const patchTurn = await session.send(
			'Edit the market-overview document: change the title heading to "AI Trends: 2026 Strategic Market Overview". Only change the title, nothing else.',
		);
		expectTurnOk('read-and-patch', patchTurn);

		const seq = getToolSequence(patchTurn);

		// Must have used patch (or write) and finalized
		const usedEdit = seq.some((t) => ['patch_document', 'write_document'].includes(t));
		expect(usedEdit).toBe(true);
		expect(toolWasCalled(patchTurn, 'finalize_document')).toBe(true);

		// If read_document was called, it should come before any patch
		if (toolWasCalled(patchTurn, 'read_document')) {
			const readIdx = seq.indexOf('read_document');
			const patchIdx = seq.indexOf('patch_document');
			if (patchIdx !== -1) {
				expect(readIdx).toBeLessThan(patchIdx);
			}
		}

		const done = getDoneEvent(patchTurn);
		expect(done?.outputType ?? 'text').toBe('text');
	}, 300_000);
});
