/**
 * Document event handler streaming tests.
 *
 * - Internal docs (is_internal=true): document_delta and document_edit suppressed
 * - Non-internal docs (is_internal=false): document_delta and document_edit emitted
 * - document_start carries isInternal flag from begin_document result
 * - document_start and document_complete always emit regardless of is_internal
 */

import type { AgentStreamEvent } from "@/common/ai/agent/types";
import { createDocumentEventHandler, type DocumentEvent } from "@/workers/chat/src/utils/document-events";

function collect() {
	const events: DocumentEvent[] = [];
	const { handle } = createDocumentEventHandler(
		{ em: {} as any, projectId: "p1" },
		(e) => events.push(e),
	);
	return { events, handle };
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

function simulateEdit(handle: (e: AgentStreamEvent) => void, opts?: { is_internal?: boolean }) {
	const isInternal = opts?.is_internal ?? true;
	handle({ type: "tool_start", tool: "begin_document", id: "tc1" });
	handle({ type: "tool_result", tool: "begin_document", id: "tc1", success: true,
		result: JSON.stringify({ status: "editing", name: "doc", title: "Doc", mode: "edit", is_internal: isInternal, loadedFrom: "approved", loadedVersion: 1 }) });
	handle({ type: "tool_start", tool: "patch_document", id: "tc2" });
	handle({ type: "tool_call_delta", tool: "patch_document", id: "tc2",
		delta: '{"edits":[{"startLine":1,"endLine":1,"oldContent":"a","newContent":"b"}]}' });
	handle({ type: "tool_result", tool: "patch_document", id: "tc2", success: true,
		result: JSON.stringify({ status: "edited", editsApplied: 1, linesNow: 5 }) });
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
			const { events, handle } = collect();
			simulateEdit(handle);
			expect(events.map((e) => e.type)).not.toContain("document_edit");
		});

		it("edit flow — document_start + document_complete still emitted", () => {
			const { events, handle } = collect();
			simulateEdit(handle);
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
			const { events, handle } = collect();
			simulateEdit(handle, { is_internal: false });
			const start = events.find((e) => e.type === "document_start");
			expect(start).toBeDefined();
			expect((start as any).isInternal).toBe(false);
		});

		it("edit flow — document_edit IS emitted for non-internal", () => {
			const { events, handle } = collect();
			simulateEdit(handle, { is_internal: false });
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
});
