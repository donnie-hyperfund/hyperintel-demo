import { describe, it, expect, beforeEach } from 'vitest';
import { DraftManager } from './draft-manager';

describe('DraftManager', () => {
	let dm: DraftManager;

	beforeEach(() => {
		dm = new DraftManager();
	});

	describe('begin', () => {
		it('creates a draft with correct fields', () => {
			const draft = dm.begin('scope-1', 'doc.md', 'My Doc', 'create');
			expect(draft.name).toBe('doc.md');
			expect(draft.title).toBe('My Doc');
			expect(draft.scopeId).toBe('scope-1');
			expect(draft.mode).toBe('create');
			expect(draft.content).toBe('');
			expect(draft.is_internal).toBe(true);
			expect(draft.document_type).toBe('Other');
			expect(draft.createdAt).toBeInstanceOf(Date);
		});

		it('accepts initial content and optional fields', () => {
			const draft = dm.begin('s', 'n.md', 't', 'edit', 'initial content', 2, false, 'Report');
			expect(draft.content).toBe('initial content');
			expect(draft.previousVersion).toBe(2);
			expect(draft.is_internal).toBe(false);
			expect(draft.document_type).toBe('Report');
		});

		it('throws if a draft is already active', () => {
			dm.begin('s', 'first.md', 'First', 'create');
			expect(() => dm.begin('s', 'second.md', 'Second', 'create')).toThrow(
				/Cannot begin draft.*already have active draft/,
			);
		});
	});

	describe('getCurrent / requireCurrent / hasActive', () => {
		it('returns null when no draft', () => {
			expect(dm.getCurrent()).toBeNull();
			expect(dm.hasActive()).toBe(false);
		});

		it('throws on requireCurrent when no draft', () => {
			expect(() => dm.requireCurrent()).toThrow(/No active draft/);
		});

		it('returns the draft after begin', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create');
			expect(dm.getCurrent()).not.toBeNull();
			expect(dm.hasActive()).toBe(true);
			expect(dm.requireCurrent().name).toBe('doc.md');
		});
	});

	describe('append', () => {
		it('appends content to the draft', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create');
			dm.append('line 1\n');
			dm.append('line 2\n');
			expect(dm.requireCurrent().content).toBe('line 1\nline 2\n');
		});

		it('throws when no active draft', () => {
			expect(() => dm.append('content')).toThrow(/No active draft/);
		});
	});

	describe('setContent', () => {
		it('replaces entire content', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create', 'old content');
			dm.setContent('new content');
			expect(dm.requireCurrent().content).toBe('new content');
		});
	});

	describe('searchReplace', () => {
		it('replaces matching text and returns count', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create', 'foo bar foo baz foo');
			const count = dm.searchReplace('foo', 'qux');
			expect(count).toBe(3);
			expect(dm.requireCurrent().content).toBe('qux bar qux baz qux');
		});

		it('returns 0 when no match', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create', 'hello world');
			expect(dm.searchReplace('xyz', 'abc')).toBe(0);
		});

		it('escapes regex special characters', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create', 'price is $10.00');
			const count = dm.searchReplace('$10.00', '$20.00');
			expect(count).toBe(1);
			expect(dm.requireCurrent().content).toBe('price is $20.00');
		});
	});

	describe('finalize', () => {
		it('returns draft data and clears state', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create');
			dm.append('content');
			const finalized = dm.finalize();
			expect(finalized.name).toBe('doc.md');
			expect(finalized.content).toBe('content');
			expect(dm.hasActive()).toBe(false);
			expect(dm.getCurrent()).toBeNull();
		});

		it('allows beginning a new draft after finalize', () => {
			dm.begin('s', 'first.md', 'First', 'create');
			dm.finalize();
			const second = dm.begin('s', 'second.md', 'Second', 'create');
			expect(second.name).toBe('second.md');
		});
	});

	describe('discard', () => {
		it('clears active draft without returning it', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create');
			dm.discard();
			expect(dm.hasActive()).toBe(false);
		});

		it('does not throw when no draft', () => {
			expect(() => dm.discard()).not.toThrow();
		});
	});

	describe('clear', () => {
		it('clears all state', () => {
			dm.begin('s', 'doc.md', 'Doc', 'create');
			dm.clear();
			expect(dm.hasActive()).toBe(false);
		});
	});

	describe('full workflow: begin → write → finalize', () => {
		it('produces correct final content', () => {
			dm.begin('project-1', 'analysis.md', 'Market Analysis', 'create', '', undefined, false, 'Report');
			dm.append('# Market Analysis\n\n');
			dm.append('## Section 1\n');
			dm.append('Content here.\n');

			const result = dm.finalize();
			expect(result.content).toBe('# Market Analysis\n\n## Section 1\nContent here.\n');
			expect(result.title).toBe('Market Analysis');
			expect(result.is_internal).toBe(false);
			expect(result.document_type).toBe('Report');
		});
	});

	describe('full workflow: begin(edit) → searchReplace → finalize', () => {
		it('edits existing content', () => {
			dm.begin('s', 'doc.md', 'Doc', 'edit', 'Hello World\nFoo Bar\n', 1);
			dm.searchReplace('Foo', 'Baz');
			const result = dm.finalize();
			expect(result.content).toBe('Hello World\nBaz Bar\n');
			expect(result.mode).toBe('edit');
			expect(result.previousVersion).toBe(1);
		});
	});
});
