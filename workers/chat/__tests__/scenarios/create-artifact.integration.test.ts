/**
 * Integration test: Document creation through the real chat handler.
 *
 * Exercises the full chatActionHandler with real inference, real DB, mocked CF primitives.
 * Supports checkpoint caching via TEST_CACHE_KEY to skip expensive inference on re-runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSession, teardownTestSession, canRunChatTests } from '../harness';
import {
	expectTurnOk,
	toolWasCalled,
	documentWasCreated,
	getToolSequence,
	getDoneEvent,
} from '../helpers';
import type { TestSession } from '../harness';

describe.skipIf(!canRunChatTests())('Chat handler: document creation', () => {
	let session: TestSession;

	beforeAll(async () => {
		session = await createTestSession({ phase: 'discovery' });
	});

	afterAll(async () => {
		await teardownTestSession();
	});

	it('creates a document when asked', async () => {
		const turn = await session.send(
			'Please create a short research report document called "market-overview" about AI trends in 2026. Keep it brief — just 3-4 paragraphs.',
		);

		expectTurnOk('create-artifact', turn);

		// Should have used document tools
		expect(toolWasCalled(turn, 'begin_document')).toBe(true);
		expect(toolWasCalled(turn, 'write_document')).toBe(true);
		expect(toolWasCalled(turn, 'finalize_document')).toBe(true);

		// A document should have been created
		expect(documentWasCreated(turn)).toBe(true);

		// Tool order: begin before write before finalize
		const seq = getToolSequence(turn);
		const beginIdx = seq.indexOf('begin_document');
		const writeIdx = seq.indexOf('write_document');
		const finalizeIdx = seq.indexOf('finalize_document');
		expect(beginIdx).toBeLessThan(writeIdx);
		expect(writeIdx).toBeLessThan(finalizeIdx);

		// Done event should be text (not terminal tool)
		const done = getDoneEvent(turn);
		expect(done?.outputType ?? 'text').toBe('text');
	}, 120_000);
});
