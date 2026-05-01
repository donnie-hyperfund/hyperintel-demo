import { describe, expect, it } from "vitest";
import { looksLikeCompletionBriefIntent } from "./cb-intent";

describe("looksLikeCompletionBriefIntent", () => {
	describe("null / empty inputs", () => {
		it("returns false for null", () => expect(looksLikeCompletionBriefIntent(null)).toBe(false));
		it("returns false for undefined", () =>
			expect(looksLikeCompletionBriefIntent(undefined)).toBe(false));
		it("returns false for empty string", () => expect(looksLikeCompletionBriefIntent("")).toBe(false));
		it("returns false for whitespace", () =>
			expect(looksLikeCompletionBriefIntent("   ")).toBe(false));
	});

	describe("completion brief", () => {
		it("matches exact phrase", () =>
			expect(looksLikeCompletionBriefIntent("generate the completion brief")).toBe(true));
		it("matches mixed case", () =>
			expect(looksLikeCompletionBriefIntent("Completion Brief please")).toBe(true));
		it("matches with punctuation", () =>
			expect(looksLikeCompletionBriefIntent("let's do a completion brief!")).toBe(true));
		it("does not match 'complete' alone", () =>
			expect(looksLikeCompletionBriefIntent("complete the task")).toBe(false));
		it("does not match 'briefly' alone", () =>
			expect(looksLikeCompletionBriefIntent("explain it briefly")).toBe(false));
	});

	describe("\\bCB\\b", () => {
		it("matches standalone CB", () =>
			expect(looksLikeCompletionBriefIntent("can you do the CB now?")).toBe(true));
		it("matches CB at sentence start", () =>
			expect(looksLikeCompletionBriefIntent("CB please")).toBe(true));
		it("does not match CBC", () =>
			expect(looksLikeCompletionBriefIntent("CBC is a network")).toBe(false));
		it("does not match backup", () =>
			expect(looksLikeCompletionBriefIntent("backup the files")).toBe(false));
		it("does not match 'backup completion'", () =>
			expect(looksLikeCompletionBriefIntent("backup completion")).toBe(false));
		it("does not match lowercase cb mid-word", () =>
			expect(looksLikeCompletionBriefIntent("scba gear")).toBe(false));
	});

	describe("next phase", () => {
		it("matches 'next phase'", () =>
			expect(looksLikeCompletionBriefIntent("let's move to next phase")).toBe(true));
		it("matches 'move to next phase'", () =>
			expect(looksLikeCompletionBriefIntent("move to next phase")).toBe(true));
		it("matches 'move to the next phase'", () =>
			expect(looksLikeCompletionBriefIntent("move to the next phase")).toBe(true));
		it("matches mixed case", () =>
			expect(looksLikeCompletionBriefIntent("Let's Go To Next Phase")).toBe(true));
	});

	describe("generate summary", () => {
		it("matches exact phrase", () =>
			expect(looksLikeCompletionBriefIntent("generate summary")).toBe(true));
		it("matches with context", () =>
			expect(looksLikeCompletionBriefIntent("please generate summary of this phase")).toBe(true));
		it("does not match 'summarized' alone", () =>
			expect(looksLikeCompletionBriefIntent("this was well summarized")).toBe(false));
	});

	describe("phase transition", () => {
		it("matches exact phrase", () =>
			expect(looksLikeCompletionBriefIntent("time for a phase transition")).toBe(true));
		it("matches mixed case", () =>
			expect(looksLikeCompletionBriefIntent("Phase Transition")).toBe(true));
	});

	describe("extra heuristics (wrap/close/finish phase)", () => {
		it("matches 'wrap up this phase'", () =>
			expect(looksLikeCompletionBriefIntent("let's wrap up this phase")).toBe(true));
		it("matches 'wrap up phase'", () =>
			expect(looksLikeCompletionBriefIntent("wrap up phase")).toBe(true));
		it("matches 'close out this phase'", () =>
			expect(looksLikeCompletionBriefIntent("close out this phase")).toBe(true));
		it("matches 'finish this phase'", () =>
			expect(looksLikeCompletionBriefIntent("finish this phase")).toBe(true));
		it("does not match 'wrap up the task'", () =>
			expect(looksLikeCompletionBriefIntent("wrap up the task")).toBe(false));
		it("does not match 'close the door'", () =>
			expect(looksLikeCompletionBriefIntent("close the door")).toBe(false));
	});
});
