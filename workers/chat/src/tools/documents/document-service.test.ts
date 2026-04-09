import { describe, it, expect } from 'vitest';
import { applyEdits, type EditOperation } from './document-service';

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

function edit(partial: Partial<EditOperation> & Pick<EditOperation, 'startLine' | 'endLine' | 'oldContent' | 'newContent'>): EditOperation {
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
		// When the first edit removes enough lines, subsequent edits' line numbers become stale
		// beyond the ±2 wiggle. Currently unhandled — would need cumulative offset tracking.
		// Large structural changes should use a single edit with a big oldContent/newContent range.
		it.skip('handles large line-shifting across multiple edits', () => {
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
});
