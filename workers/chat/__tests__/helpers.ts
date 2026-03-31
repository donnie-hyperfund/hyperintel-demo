/**
 * Event assertion utilities for chat handler integration tests.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { StreamEvent } from '../src/utils/stream';
import type { TurnResult } from './harness';

const ERRORS_DIR = path.resolve(import.meta.dirname, '_errors');

// ============================================================================
// EVENT FILTERS
// ============================================================================

/** Get all events of a specific type from a turn. */
export function getEvents<T extends StreamEvent['type']>(
	turn: TurnResult,
	type: T,
): Extract<StreamEvent, { type: T }>[] {
	return turn.events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type);
}

/** Check if any event of a type exists. */
export function hasEvent(turn: TurnResult, type: StreamEvent['type']): boolean {
	return turn.events.some((e) => e.type === type);
}

// ============================================================================
// TOOL ASSERTIONS
// ============================================================================

/** Get all tool_start events. */
export function getToolStarts(turn: TurnResult) {
	return getEvents(turn, 'tool_start');
}

/** Get all tool_result events. */
export function getToolResults(turn: TurnResult) {
	return getEvents(turn, 'tool_result');
}

/** Get the sequence of tool names called in a turn. */
export function getToolSequence(turn: TurnResult): string[] {
	return getToolStarts(turn).map((e) => e.tool);
}

/** Check if a specific tool was called. */
export function toolWasCalled(turn: TurnResult, toolName: string): boolean {
	return getToolStarts(turn).some((e) => e.tool === toolName);
}

/** Check if all tool results were successful. */
export function allToolsSucceeded(turn: TurnResult): boolean {
	const results = getToolResults(turn);
	return results.length > 0 && results.every((r) => r.success);
}

/** Get failed tool results with their error details. Use with expect for readable failures. */
export function getFailedTools(turn: TurnResult) {
	return getToolResults(turn)
		.filter((r) => !r.success)
		.map((r) => ({ tool: getToolStarts(turn).find((s) => s.id === r.id)?.tool ?? r.id, result: r.result }));
}

// ============================================================================
// DOCUMENT ASSERTIONS
// ============================================================================

/** Get document_complete events (finalized documents). */
export function getDocumentCompletes(turn: TurnResult) {
	return getEvents(turn, 'document_complete');
}

/** Get document_start events. */
export function getDocumentStarts(turn: TurnResult) {
	return getEvents(turn, 'document_start');
}

/** Check if a document was created (begin → finalize). */
export function documentWasCreated(turn: TurnResult, nameSubstring?: string): boolean {
	const completes = getDocumentCompletes(turn);
	if (nameSubstring) {
		return completes.some((e) => e.name.includes(nameSubstring));
	}
	return completes.length > 0;
}

// ============================================================================
// DONE / ERROR ASSERTIONS
// ============================================================================

/** Get the done event (should be exactly one per turn). */
export function getDoneEvent(turn: TurnResult) {
	const dones = getEvents(turn, 'done');
	return dones[0] ?? null;
}

/** Check if the turn completed without fatal errors. */
export function turnCompletedOk(turn: TurnResult): boolean {
	const done = getDoneEvent(turn);
	return !!done && !done.error;
}

/** Check if a phase transition was triggered (generate_summary). */
export function phaseTransitionTriggered(turn: TurnResult): boolean {
	const done = getDoneEvent(turn);
	return !!done && done.outputType === 'tool' && done.outputTool === 'generate_summary';
}

/** Get all error events. */
export function getErrors(turn: TurnResult) {
	return getEvents(turn, 'error');
}

// ============================================================================
// TEXT ASSERTIONS
// ============================================================================

/** Collect all text deltas into a single string. */
export function getFullText(turn: TurnResult): string {
	return getEvents(turn, 'delta')
		.map((e) => e.text)
		.join('');
}

// ============================================================================
// SUMMARY HELPERS
// ============================================================================

/** Print a concise summary of a turn for debugging. */
export function summarizeTurn(turn: TurnResult): string {
	const tools = getToolSequence(turn);
	const docs = getDocumentCompletes(turn).map((d) => d.name);
	const done = getDoneEvent(turn);
	const errors = getErrors(turn);
	const failed = getFailedTools(turn);
	const text = getFullText(turn).slice(0, 200);

	return [
		`Turn: ${turn.agentMessageId.slice(0, 8)}`,
		`  Tools: [${tools.join(', ')}]`,
		`  Docs created: [${docs.join(', ')}]`,
		`  Done: ${done ? `outputType=${done.outputType ?? 'text'}` : 'MISSING'}`,
		errors.length > 0 ? `  Errors: ${JSON.stringify(errors)}` : null,
		failed.length > 0 ? `  Failed tools:\n${failed.map((f) => `    - ${f.tool}: ${f.result}`).join('\n')}` : null,
		text ? `  Text: "${text}${text.length >= 200 ? '...' : ''}"` : null,
	]
		.filter(Boolean)
		.join('\n');
}

// ============================================================================
// ERROR LOG
// ============================================================================

/**
 * Dump a failed turn to _errors/ for post-mortem debugging.
 *
 * Usage in tests:
 * ```ts
 * const turn = await session.send('...');
 * if (!allToolsSucceeded(turn)) dumpErrorLog('edit-artifact', turn);
 * expect(getFailedTools(turn)).toEqual([]);
 * ```
 *
 * Or use `expectTurnOk(name, turn)` which does this automatically.
 */
export function dumpErrorLog(scenario: string, turn: TurnResult): string {
	if (!fs.existsSync(ERRORS_DIR)) {
		fs.mkdirSync(ERRORS_DIR, { recursive: true });
	}

	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `${scenario}.${ts}.error.json`;
	const filePath = path.join(ERRORS_DIR, filename);

	const data = {
		scenario,
		timestamp: new Date().toISOString(),
		summary: summarizeTurn(turn),
		failedTools: getFailedTools(turn),
		errors: getErrors(turn),
		toolSequence: getToolSequence(turn),
		toolResults: getToolResults(turn),
		text: getFullText(turn),
		done: getDoneEvent(turn),
		allEvents: turn.events,
	};

	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
	return filePath;
}

/**
 * Assert a turn completed successfully. Dumps error log and fails with useful info if not.
 *
 * Replaces the pattern:
 * ```ts
 * expect(turnCompletedOk(turn)).toBe(true);
 * expect(allToolsSucceeded(turn)).toBe(true);
 * ```
 *
 * With:
 * ```ts
 * expectTurnOk('create-artifact', turn);
 * ```
 */
export function expectTurnOk(scenario: string, turn: TurnResult) {
	const failed = getFailedTools(turn);
	const errors = getErrors(turn);
	const done = getDoneEvent(turn);

	if (failed.length > 0 || errors.length > 0 || !done || done.error) {
		const logPath = dumpErrorLog(scenario, turn);
		const failMsg = [
			`Turn failed — error log: ${logPath}`,
			failed.length > 0 ? `Failed tools:\n${failed.map((f) => `  - ${f.tool}: ${f.result}`).join('\n')}` : null,
			errors.length > 0 ? `Errors: ${errors.map((e) => e.error).join(', ')}` : null,
			done?.error ? `Done error: ${done.error}` : null,
			!done ? 'No done event received' : null,
		]
			.filter(Boolean)
			.join('\n');

		throw new Error(failMsg);
	}
}
