/**
 * Document event handler streaming tests.
 *
 * - Internal docs (is_internal=true): document_delta and document_edit suppressed
 * - Non-internal docs (is_internal=false): document_delta and document_edit emitted
 * - document_start carries isInternal flag from begin_document result
 * - document_start and document_complete always emit regardless of is_internal
 */

import type { AgentStreamEvent } from "@/common/ai/agent/types";
import { createDocumentTools, DraftManager, type DocumentToolsContext } from "@/workers/chat/src/tools/documents";
import { createDocumentEventHandler, type DocumentEvent } from "@/workers/chat/src/utils/document-events";

function collect() {
	const events: DocumentEvent[] = [];
	const draftManager = new DraftManager();
	const { handle } = createDocumentEventHandler(
		{ em: {} as any, projectId: "p1", draftManager },
		(e) => events.push(e),
	);
	return { events, handle, draftManager };
}

function simulateWrite(handle: (e: AgentStreamEvent) => void, opts?: { is_internal?: boolean }) {
	const isInternal = opts?.is_internal ?? true;
	handle({ type: "tool_start", tool: "begin_document", id: "tc1" });
	handle({ type: "tool_result", tool: "begin_document", id: "tc1", success: true,
		result: JSON.stringify({ status: "editing", name: "doc", title: "Doc", mode: "create", is_internal: isInternal }) });
	handle({ type: "tool_start", tool: "write_document", id: "tc2" });
	handle({ type: "tool_call_delta", tool: "write_document", id: "tc2", delta: '{"content":"secret stuff"}' });
	handle({ type: "tool_result", tool: "write_document", id: "tc2", success: true,
		result: JSON.stringify({ status: "written", lines: 5 }) });
	handle({ type: "tool_start", tool: "finalize_document", id: "tc3" });
	handle({ type: "tool_result", tool: "finalize_document", id: "tc3", success: true,
		result: JSON.stringify({ name: "doc", version: 1, lines: 5, action: "created" }) });
}

function simulateEdit(
	handle: (e: AgentStreamEvent) => void,
	draftManager: DraftManager,
	opts?: { is_internal?: boolean },
) {
	const isInternal = opts?.is_internal ?? true;
	handle({ type: "tool_start", tool: "begin_document", id: "tc1" });
	handle({ type: "tool_result", tool: "begin_document", id: "tc1", success: true,
		result: JSON.stringify({ status: "editing", name: "doc", title: "Doc", mode: "edit", is_internal: isInternal, loadedFrom: "approved", loadedVersion: 1, nextVersion: 2 }) });
	handle({ type: "tool_start", tool: "patch_document", id: "tc2" });
	// Real executor stashes applied edits by tool_call_id; mirror that here.
	draftManager.setAppliedEdits("tc2", [{ startLine: 1, endLine: 1, oldContent: "a", newContent: "b" }]);
	handle({ type: "tool_result", tool: "patch_document", id: "tc2", success: true,
		result: JSON.stringify({
			status: "edited",
			editsApplied: 1,
			linesNow: 5,
		}) });
	handle({ type: "tool_start", tool: "finalize_document", id: "tc3" });
	handle({ type: "tool_result", tool: "finalize_document", id: "tc3", success: true,
		result: JSON.stringify({ name: "doc", version: 2, lines: 5, action: "edited", supersededVersion: 1 }) });
}

describe("stream document content redaction", () => {
	describe("internal documents (is_internal=true)", () => {
		it("write flow — no document_delta emitted", () => {
			const { events, handle } = collect();
			simulateWrite(handle);
			expect(events.map((e) => e.type)).not.toContain("document_delta");
		});

		it("write flow — document_start + document_complete still emitted", () => {
			const { events, handle } = collect();
			simulateWrite(handle);
			const types = events.map((e) => e.type);
			expect(types).toContain("document_start");
			expect(types).toContain("document_complete");
		});

		it("write flow — document_start carries isInternal=true", () => {
			const { events, handle } = collect();
			simulateWrite(handle);
			const start = events.find((e) => e.type === "document_start");
			expect(start).toBeDefined();
			expect((start as any).isInternal).toBe(true);
		});

		it("edit flow — no document_edit emitted", () => {
			const { events, handle, draftManager } = collect();
			simulateEdit(handle, draftManager);
			expect(events.map((e) => e.type)).not.toContain("document_edit");
		});

		it("edit flow — document_start + document_complete still emitted", () => {
			const { events, handle, draftManager } = collect();
			simulateEdit(handle, draftManager);
			const types = events.map((e) => e.type);
			expect(types).toContain("document_start");
			expect(types).toContain("document_complete");
		});
	});

	describe("non-internal documents (is_internal=false)", () => {
		it("write flow — document_start carries isInternal=false", () => {
			const { events, handle } = collect();
			simulateWrite(handle, { is_internal: false });
			const start = events.find((e) => e.type === "document_start");
			expect(start).toBeDefined();
			expect((start as any).isInternal).toBe(false);
		});

		it("write flow — document_delta IS emitted for non-internal", () => {
			const { events, handle } = collect();
			simulateWrite(handle, { is_internal: false });
			expect(events.map((e) => e.type)).toContain("document_delta");
		});

		it("edit flow — document_start carries isInternal=false", () => {
			const { events, handle, draftManager } = collect();
			simulateEdit(handle, draftManager, { is_internal: false });
			const start = events.find((e) => e.type === "document_start");
			expect(start).toBeDefined();
			expect((start as any).isInternal).toBe(false);
		});

		it("edit flow — document_edit IS emitted for non-internal", () => {
			const { events, handle, draftManager } = collect();
			simulateEdit(handle, draftManager, { is_internal: false });
			expect(events.map((e) => e.type)).toContain("document_edit");
		});

		it("write flow — document_start + document_complete still emitted", () => {
			const { events, handle } = collect();
			simulateWrite(handle, { is_internal: false });
			const types = events.map((e) => e.type);
			expect(types).toContain("document_start");
			expect(types).toContain("document_complete");
		});
	});

	describe('begin_document(mode="replace") streaming contract', () => {
		// FE consumes document_start.mode at use-stream.ts: when mode === 'replace',
		// streamingDocs draftContent is set to '' (skipping loaded artifact content).
		// DO already starts every doc with content: '' on document_start. So the
		// invariant that downstream depends on is: document_start.mode === 'replace'
		// is forwarded faithfully and any subsequent deltas append onto an empty draft.
		function simulateReplace(handle: (e: AgentStreamEvent) => void, opts?: { is_internal?: boolean }) {
			const isInternal = opts?.is_internal ?? false;
			handle({ type: "tool_start", tool: "begin_document", id: "tc1" });
			handle({ type: "tool_result", tool: "begin_document", id: "tc1", success: true,
				result: JSON.stringify({
					status: "editing", name: "doc", title: "Doc", mode: "replace",
					is_internal: isInternal, loadedFrom: "approved", loadedVersion: 1,
				}) });
			handle({ type: "tool_start", tool: "write_document", id: "tc2" });
			handle({ type: "tool_call_delta", tool: "write_document", id: "tc2",
				delta: '{"content":"NEW REPLACEMENT"}' });
			handle({ type: "tool_result", tool: "write_document", id: "tc2", success: true,
				result: JSON.stringify({ status: "written", lines: 1 }) });
		}

		it("emits document_start with mode='replace' (FE uses this to start with empty draft)", () => {
			const { events, handle } = collect();
			simulateReplace(handle);
			const start = events.find((e) => e.type === "document_start") as any;
			expect(start).toBeDefined();
			expect(start.mode).toBe("replace");
		});

		it("non-internal replace: deltas stream with the new content (will overlay an empty draft on FE/DO)", () => {
			const { events, handle } = collect();
			simulateReplace(handle, { is_internal: false });
			const deltas = events.filter((e) => e.type === "document_delta") as any[];
			const concatenated = deltas.map((d) => d.content).join("");
			expect(concatenated).toBe("NEW REPLACEMENT");
		});

		it("internal replace: deltas suppressed (no leak into stream)", () => {
			const { events, handle } = collect();
			simulateReplace(handle, { is_internal: true });
			expect(events.map((e) => e.type)).not.toContain("document_delta");
		});
	});

	describe("finalize_document(action='abort') streaming contract", () => {
		// FE consumes document_complete.status: 'aborted' clears streamingDocs without
		// persisting a proposed version. Handler MUST clear activeDoc state so any
		// late tool_result events don't accidentally re-emit document_edit/document_delta.
		function simulateAbort(handle: (e: AgentStreamEvent) => void) {
			handle({ type: "tool_start", tool: "begin_document", id: "tc1" });
			handle({ type: "tool_result", tool: "begin_document", id: "tc1", success: true,
				result: JSON.stringify({ status: "editing", name: "doc", title: "Doc", mode: "edit", is_internal: false, loadedFrom: "approved", loadedVersion: 1 }) });
			handle({ type: "tool_start", tool: "finalize_document", id: "tc2" });
			handle({ type: "tool_result", tool: "finalize_document", id: "tc2", success: true,
				result: JSON.stringify({ name: "doc", lines: 0, action: "aborted" }) });
		}

		it("emits document_complete with status='aborted' and no version field", () => {
			const { events, handle } = collect();
			simulateAbort(handle);
			const complete = events.find((e) => e.type === "document_complete") as any;
			expect(complete).toBeDefined();
			expect(complete.status).toBe("aborted");
			expect(complete.action).toBe("aborted");
			expect(complete.version).toBeUndefined();
		});

		it("clears activeDoc — late patch_document events after abort do not emit document_edit", () => {
			const { events, handle, draftManager } = collect();
			simulateAbort(handle);
			// Pretend a stale patch_document somehow fires after finalize. With activeDoc cleared, no document_edit should be emitted.
			draftManager.setAppliedEdits("tc-late", [{ startLine: 1, endLine: 1, oldContent: "a", newContent: "b" }]);
			handle({ type: "tool_start", tool: "patch_document", id: "tc-late" });
			handle({ type: "tool_result", tool: "patch_document", id: "tc-late", success: true,
				result: JSON.stringify({ status: "edited", editsApplied: 1, linesNow: 5 }) });
			expect(events.filter((e) => e.type === "document_edit")).toHaveLength(0);
		});
	});

	describe("isInternal defaults to true when not in result", () => {
		it("document_start defaults isInternal=true when begin_document omits is_internal", () => {
			const { events, handle } = collect();
			handle({ type: "tool_start", tool: "begin_document", id: "tc1" });
			handle({ type: "tool_result", tool: "begin_document", id: "tc1", success: true,
				result: JSON.stringify({ status: "editing", name: "doc", title: "Doc", mode: "create" }) });
			const start = events.find((e) => e.type === "document_start");
			expect(start).toBeDefined();
			expect((start as any).isInternal).toBe(true);
		});
	});

	describe("patch_document tool result carries no content", () => {
		// Guards the generic tool_result leak vector: appliedEdits lives on DraftManager, not in the result.
		function runRealPatchExecutor(isInternal: boolean) {
			const tools = createDocumentTools();
			const patch = tools.find((t) => t.name === "patch_document")!;
			const draftManager = new DraftManager();
			draftManager.begin("scope", "doc.md", "Doc", "edit", "alpha\nbeta\ngamma\n", 1, isInternal, "Other");
			const ctx = { draftManager, chatId: "c", createdVersionIds: [] } as unknown as DocumentToolsContext;
			const result = patch.executor(
				{ edits: [{ startLine: 2, oldContent: "beta", newContent: "BETA" }] },
				ctx,
				undefined,
				undefined,
				"tc-real",
			);
			return { result, draftManager };
		}

		it("internal doc: result has no appliedEdits / oldContent / newContent", () => {
			const { result } = runRealPatchExecutor(true);
			const serialized = JSON.stringify(result);
			expect((result as any).appliedEdits).toBeUndefined();
			expect(serialized).not.toContain("oldContent");
			expect(serialized).not.toContain("newContent");
			expect(serialized).not.toContain("beta");
			expect(serialized).not.toContain("BETA");
		});

		it("non-internal doc: same — result never carries content regardless of is_internal", () => {
			const { result } = runRealPatchExecutor(false);
			const serialized = JSON.stringify(result);
			expect((result as any).appliedEdits).toBeUndefined();
			expect(serialized).not.toContain("oldContent");
			expect(serialized).not.toContain("newContent");
		});

		it("canonical edits are stashed on DraftManager keyed by tool_call_id", () => {
			const { draftManager } = runRealPatchExecutor(false);
			const stashed = draftManager.takeAppliedEdits("tc-real");
			expect(stashed).toBeDefined();
			expect(stashed!.length).toBeGreaterThan(0);
			expect(stashed![0]).toMatchObject({ startLine: expect.any(Number), endLine: expect.any(Number) });
		});
	});
});
