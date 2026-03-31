/**
 * Event assertion utilities for chat handler integration tests.
 */

import type { StreamEvent } from '../src/utils/stream';
import type { TurnResult } from './harness';

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
	const text = getFullText(turn).slice(0, 100);

	return [
		`Turn: ${turn.agentMessageId.slice(0, 8)}`,
		`  Tools: [${tools.join(', ')}]`,
		`  Docs created: [${docs.join(', ')}]`,
		`  Done: ${done ? `outputType=${done.outputType ?? 'text'}` : 'MISSING'}`,
		errors.length > 0 ? `  Errors: ${errors.length}` : null,
		text ? `  Text: "${text}${text.length >= 100 ? '...' : ''}"` : null,
	]
		.filter(Boolean)
		.join('\n');
}
