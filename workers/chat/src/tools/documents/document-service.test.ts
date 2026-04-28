import { describe, it, expect } from 'vitest';
import { applyEdits, countLines, type EditOperation } from './document-service';

const DOC = [
	'# Title',
	'',
	'## Section 1',
	'',
	'Paragraph one content.',
	'More text here.',
	'',
	'## Section 2',
	'',
	'Paragraph two content.',
	'Another line.',
	'',
	'---',
	'',
	'*Sources: Some source (2026)*',
	'',
].join('\n');

function edit(partial: Pick<EditOperation, 'startLine' | 'oldContent' | 'newContent'> & Partial<EditOperation>): EditOperation {
	return partial;
}

describe('applyEdits', () => {
	describe('exact match', () => {
		it('replaces content at correct line range', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\nMore text here.',
					newContent: 'Replaced content.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Replaced content.');
			expect(result.newContent).not.toContain('Paragraph one content.');
		});

		it('handles single-line edit', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: '# Title',
					newContent: '# New Title',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent!.startsWith('# New Title')).toBe(true);
		});

		it('preserves surrounding content', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 8,
					endLine: 8,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Updated)',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('## Section 1');
			expect(result.newContent).toContain('## Section 2 (Updated)');
			expect(result.newContent).toContain('*Sources: Some source (2026)*');
		});
	});

	describe('patch normalization', () => {
		it('matches oldContent with CRLF line endings against LF document content', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\r\nMore text here.',
					newContent: 'Replacement A.\r\nReplacement B.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Replacement A.\nReplacement B.');
			expect(result.newContent).not.toContain('\r\n');
		});

		it('normalizes CRLF document content before matching and writing output', () => {
			const crlfDoc = DOC.replace(/\n/g, '\r\n');
			const result = applyEdits(crlfDoc, [
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\nMore text here.',
					newContent: 'Normalized replacement.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Normalized replacement.');
			expect(result.newContent).not.toContain('\r\n');
		});

		it('infers endLine from oldContent when omitted', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					oldContent: 'Paragraph one content.\nMore text here.',
					newContent: 'Inferred range replacement.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Inferred range replacement.');
			expect(result.linesNow).toBe(countLines(DOC) - 1);
		});

		it('tolerates a single trailing newline in oldContent', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					oldContent: 'Paragraph one content.\n',
					newContent: 'Trailing newline tolerated.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Trailing newline tolerated.');
		});

		it('strips read_document line-number prefixes when every copied line is numbered', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					oldContent: '5: Paragraph one content.\n6: More text here.',
					newContent: 'Copied viewport replacement.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Copied viewport replacement.');
			expect(result.newContent).not.toContain('Paragraph one content.');
		});

		it('does not strip numbered prefixes unless they look like the copied viewport', () => {
			const content = ['1: Actual content', '3: Non-sequential content'].join('\n');
			const result = applyEdits(content, [
				edit({
					startLine: 1,
					oldContent: '1: Actual content\n3: Non-sequential content',
					newContent: 'Preserved literal prefixes.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toBe('Preserved literal prefixes.');
		});
	});

	describe('off-by-one tolerance (±2 lines)', () => {
		it('finds content 1 line above specified range', () => {
			// Section 2 header is line 8, but model says 9
			const result = applyEdits(DOC, [
				edit({
					startLine: 9,
					endLine: 9,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Fixed)',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('## Section 2 (Fixed)');
		});

		it('finds content 1 line below specified range', () => {
			// Section 2 header is line 8, but model says 7
			const result = applyEdits(DOC, [
				edit({
					startLine: 7,
					endLine: 7,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Fixed)',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('## Section 2 (Fixed)');
		});

		it('finds content 2 lines off', () => {
			// Section 2 header is line 8, but model says 10
			const result = applyEdits(DOC, [
				edit({
					startLine: 10,
					endLine: 10,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Fixed)',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('## Section 2 (Fixed)');
		});

		it('fails when content is more than 2 lines off', () => {
			// Section 2 header is line 8, model says 11 — too far
			const result = applyEdits(DOC, [
				edit({
					startLine: 11,
					endLine: 11,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Fixed)',
				}),
			]);

			expect(result.success).toBe(false);
			expect(result.error).toContain('±2');
		});

		it('replaces at correct position even when wiggled', () => {
			// Sources line is 15, model says 13 (off by 2)
			// The replacement should still happen at the right place
			const result = applyEdits(DOC, [
				edit({
					startLine: 13,
					endLine: 15,
					oldContent: '---\n\n*Sources: Some source (2026)*',
					newContent: '---\n\n*Sources: Updated source (2026)*',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('*Sources: Updated source (2026)*');
			// Ensure the section above is untouched
			expect(result.newContent).toContain('Another line.');
		});

		it('prefers exact range over wiggled range', () => {
			// Line 5 has "Paragraph one content." — exact match should win
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 5,
					oldContent: 'Paragraph one content.',
					newContent: 'Exact match wins.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Exact match wins.');
		});
	});

	describe('multi-edit', () => {
		it('handles large line-shifting across multiple edits by applying bottom-up', () => {
			const result = applyEdits(DOC, [
				edit({
					// Remove lines 3-7 (5 lines become 1) — shifts everything below by -4
					startLine: 3,
					endLine: 7,
					oldContent: '## Section 1\n\nParagraph one content.\nMore text here.\n',
					newContent: 'Collapsed.',
				}),
				edit({
					// Section 2 was line 8, now line 4 after removing 4 lines above.
					// Model still references line 8 (pre-edit numbering). Off by 4 > wiggle of 2.
					startLine: 8,
					endLine: 8,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Edited)',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('Collapsed.');
			expect(result.newContent).toContain('## Section 2 (Edited)');
		});

		it('applies multiple edits atomically', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: '# Title',
					newContent: '# Updated Title',
				}),
				edit({
					startLine: 8,
					endLine: 8,
					oldContent: '## Section 2',
					newContent: '## Section 2 (Revised)',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('# Updated Title');
			expect(result.newContent).toContain('## Section 2 (Revised)');
		});
	});

	describe('validation errors', () => {
		it('rejects invalid line range (start < 1)', () => {
			const result = applyEdits(DOC, [
				edit({ startLine: 0, endLine: 1, oldContent: 'x', newContent: 'y' }),
			]);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Invalid line range');
		});

		it('rejects invalid line range (end > total)', () => {
			const result = applyEdits(DOC, [
				edit({ startLine: 1, endLine: 999, oldContent: 'x', newContent: 'y' }),
			]);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Invalid line range');
		});

		it('rejects invalid line range (start > end)', () => {
			const result = applyEdits(DOC, [
				edit({ startLine: 5, endLine: 3, oldContent: 'x', newContent: 'y' }),
			]);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Invalid line range');
		});

		it('rejects when oldContent not found anywhere near range', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: 'This text does not exist',
					newContent: 'y',
				}),
			]);

			expect(result.success).toBe(false);
			expect(result.error).toContain('oldContent not found');
		});

		it('rejects ambiguous match', () => {
			// Create a doc with repeated content
			const repeatedDoc = 'AAA\nBBB\nAAA\nBBB\nAAA';
			const result = applyEdits(repeatedDoc, [
				edit({
					startLine: 1,
					endLine: 5,
					oldContent: 'AAA',
					newContent: 'CCC',
				}),
			]);

			expect(result.success).toBe(false);
			expect(result.error).toContain('Multiple matches');
		});

		it('fails atomically — no partial application', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: '# Title',
					newContent: '# Good Edit',
				}),
				edit({
					startLine: 5,
					endLine: 5,
					oldContent: 'NONEXISTENT CONTENT',
					newContent: 'Bad Edit',
				}),
			]);

			expect(result.success).toBe(false);
			// First edit should NOT have been applied
			expect(result.newContent).toBeUndefined();
		});
	});

	describe('edge cases', () => {
		it('handles edit at last non-empty line', () => {
			// Line 15 is "*Sources: Some source (2026)*" — last meaningful line
			const result = applyEdits(DOC, [
				edit({
					startLine: 15,
					endLine: 15,
					oldContent: '*Sources: Some source (2026)*',
					newContent: '*Sources: Updated (2026)*',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('*Sources: Updated (2026)*');
		});

		it('handles edit that changes line count', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\nMore text here.',
					newContent: 'Single line replacement.',
				}),
			]);

			expect(result.success).toBe(true);
			const originalLines = DOC.split('\n').length;
			expect(result.linesNow).toBe(originalLines - 1);
		});

		it('handles edit that expands content', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 5,
					oldContent: 'Paragraph one content.',
					newContent: 'Line A.\nLine B.\nLine C.',
				}),
			]);

			expect(result.success).toBe(true);
			const originalLines = DOC.split('\n').length;
			expect(result.linesNow).toBe(originalLines + 2);
		});

		it('wiggle does not go below line 1', () => {
			// Targeting line 1 with wiggle should not crash trying line -1
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: '# Title',
					newContent: '# Safe',
				}),
			]);

			expect(result.success).toBe(true);
		});

		it('wiggle does not go past last line', () => {
			// Sources is line 15, wiggle +2 = 17 which exceeds doc length (16).
			// Should still find it without crashing.
			const result = applyEdits(DOC, [
				edit({
					startLine: 15,
					endLine: 15,
					oldContent: '*Sources: Some source (2026)*',
					newContent: '*Sources: Safe end*',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.newContent).toContain('*Sources: Safe end*');
		});

		it('empty edits array succeeds', () => {
			const result = applyEdits(DOC, []);
			expect(result.success).toBe(true);
			expect(result.newContent).toBe(DOC);
		});
	});

	describe('appliedEdits — canonical output for stream replay', () => {
		it('returns resolved line range, full-range oldContent, and full-range newContent', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\nMore text here.',
					newContent: 'Replaced.',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.appliedEdits).toHaveLength(1);
			const [applied] = result.appliedEdits!;
			expect(applied.startLine).toBe(5);
			expect(applied.endLine).toBe(6);
			// oldContent is the FULL range text, not just the matched substring
			expect(applied.oldContent).toBe('Paragraph one content.\nMore text here.');
			expect(applied.newContent).toBe('Replaced.');
		});

		it('reports the resolved startLine after wiggle correction', () => {
			// Section 2 is at line 8, model points to line 10 (off by 2)
			const result = applyEdits(DOC, [
				edit({
					startLine: 10,
					endLine: 10,
					oldContent: '## Section 2',
					newContent: '## Section 2 (fixed)',
				}),
			]);

			expect(result.success).toBe(true);
			const [applied] = result.appliedEdits!;
			expect(applied.startLine).toBe(8);
			expect(applied.endLine).toBe(8);
			expect(applied.oldContent).toBe('## Section 2');
		});

		it('reports normalized (LF) oldContent even when input was CRLF', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\r\nMore text here.',
					newContent: 'Replaced.\r\n',
				}),
			]);

			expect(result.success).toBe(true);
			const [applied] = result.appliedEdits!;
			expect(applied.oldContent).not.toContain('\r');
			expect(applied.newContent).not.toContain('\r');
		});

		it('reports oldContent with viewport prefixes stripped when the backend stripped them', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 5,
					oldContent: '5: Paragraph one content.\n6: More text here.',
					newContent: 'Replaced.',
				}),
			]);

			expect(result.success).toBe(true);
			const [applied] = result.appliedEdits!;
			// Emitted oldContent is the actual range text — no "N: " prefixes
			expect(applied.oldContent).toBe('Paragraph one content.\nMore text here.');
		});

		it('returns multi-edit appliedEdits in replay-safe bottom-up order', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: '# Title',
					newContent: '# New',
				}),
				edit({
					startLine: 5,
					endLine: 6,
					oldContent: 'Paragraph one content.\nMore text here.',
					newContent: 'Collapsed paragraph.',
				}),
				edit({
					startLine: 8,
					endLine: 8,
					oldContent: '## Section 2',
					newContent: '## Updated Section 2',
				}),
			]);

			expect(result.success).toBe(true);
			expect(result.appliedEdits).toHaveLength(3);
			expect(result.appliedEdits!.map((e) => e.startLine)).toEqual([8, 5, 1]);

			// Forward replay works because the payload itself is bottom-up.
			let replayed = DOC.replace(/\r\n?/g, '\n').split('\n');
			for (const e of result.appliedEdits!) {
				replayed = [
					...replayed.slice(0, e.startLine - 1),
					...e.newContent.split('\n'),
					...replayed.slice(e.endLine),
				];
			}
			expect(replayed.join('\n')).toBe(result.newContent);
		});

		it('omits appliedEdits on failure', () => {
			const result = applyEdits(DOC, [
				edit({
					startLine: 1,
					endLine: 1,
					oldContent: 'DOES NOT EXIST',
					newContent: 'X',
				}),
			]);

			expect(result.success).toBe(false);
			expect(result.appliedEdits).toBeUndefined();
		});
	});
});
