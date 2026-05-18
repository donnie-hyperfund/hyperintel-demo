import { describe, it, expect, beforeEach } from 'vitest';
import { DraftManager } from './draft-manager';

function beginDraft(
    dm: DraftManager,
    overrides: {
        scopeId?: string;
        name?: string;
        title?: string;
        mode?: 'create' | 'replace' | 'edit';
        reservedVersion?: number;
        initialContent?: string;
        previousVersion?: number;
        is_internal?: boolean;
        document_type?: string;
        artifactId?: string;
    } = {},
) {
    return dm.begin({
        artifactId: overrides.artifactId ?? 'artifact-1',
        scopeId: overrides.scopeId ?? 's',
        name: overrides.name ?? 'doc.md',
        title: overrides.title ?? 'Doc',
        mode: overrides.mode ?? 'create',
        reservedVersion: overrides.reservedVersion ?? 1,
        ...(overrides.initialContent !== undefined ? { initialContent: overrides.initialContent } : {}),
        ...(overrides.previousVersion !== undefined ? { previousVersion: overrides.previousVersion } : {}),
        ...(overrides.is_internal !== undefined ? { is_internal: overrides.is_internal } : {}),
        ...(overrides.document_type !== undefined ? { document_type: overrides.document_type } : {}),
    });
}

describe('DraftManager', () => {
    let dm: DraftManager;

    beforeEach(() => {
        dm = new DraftManager();
    });

    describe('begin', () => {
        it('creates a draft with correct fields', () => {
            const draft = beginDraft(dm, { scopeId: 'scope-1', title: 'My Doc' });
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
            const draft = beginDraft(dm, {
                name: 'n.md',
                title: 't',
                mode: 'edit',
                initialContent: 'initial content',
                previousVersion: 2,
                is_internal: false,
                document_type: 'Report',
            });
            expect(draft.content).toBe('initial content');
            expect(draft.previousVersion).toBe(2);
            expect(draft.is_internal).toBe(false);
            expect(draft.document_type).toBe('Report');
        });

        it('throws if a draft is already active', () => {
            beginDraft(dm, { name: 'first.md', title: 'First' });
            expect(() => beginDraft(dm, { name: 'second.md', title: 'Second' })).toThrow(
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
            beginDraft(dm);
            expect(dm.getCurrent()).not.toBeNull();
            expect(dm.hasActive()).toBe(true);
            expect(dm.requireCurrent().name).toBe('doc.md');
        });
    });

    describe('append', () => {
        it('appends content to the draft', () => {
            beginDraft(dm);
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
            beginDraft(dm, { initialContent: 'old content' });
            dm.setContent('new content');
            expect(dm.requireCurrent().content).toBe('new content');
        });
    });

    describe('searchReplace', () => {
        it('replaces matching text and returns count', () => {
            beginDraft(dm, { initialContent: 'foo bar foo baz foo' });
            const count = dm.searchReplace('foo', 'qux');
            expect(count).toBe(3);
            expect(dm.requireCurrent().content).toBe('qux bar qux baz qux');
        });

        it('returns 0 when no match', () => {
            beginDraft(dm, { initialContent: 'hello world' });
            expect(dm.searchReplace('xyz', 'abc')).toBe(0);
        });

        it('escapes regex special characters', () => {
            beginDraft(dm, { initialContent: 'price is $10.00' });
            const count = dm.searchReplace('$10.00', '$20.00');
            expect(count).toBe(1);
            expect(dm.requireCurrent().content).toBe('price is $20.00');
        });
    });

    describe('finalize', () => {
        it('returns draft data and clears state', () => {
            beginDraft(dm);
            dm.append('content');
            const finalized = dm.finalize();
            expect(finalized.name).toBe('doc.md');
            expect(finalized.content).toBe('content');
            expect(dm.hasActive()).toBe(false);
            expect(dm.getCurrent()).toBeNull();
        });

        it('allows beginning a new draft after finalize', () => {
            beginDraft(dm, { name: 'first.md', title: 'First' });
            dm.finalize();
            const second = beginDraft(dm, { name: 'second.md', title: 'Second' });
            expect(second.name).toBe('second.md');
        });
    });

    describe('discard', () => {
        it('clears active draft without returning it', () => {
            beginDraft(dm);
            dm.discard();
            expect(dm.hasActive()).toBe(false);
        });

        it('does not throw when no draft', () => {
            expect(() => dm.discard()).not.toThrow();
        });
    });

    describe('clear', () => {
        it('clears all state', () => {
            beginDraft(dm);
            dm.clear();
            expect(dm.hasActive()).toBe(false);
        });
    });

    describe('appliedEdits side channel', () => {
        const edits = [{ startLine: 1, endLine: 2, oldContent: 'a', newContent: 'b' }];

        it('take returns undefined when nothing stashed', () => {
            expect(dm.takeAppliedEdits('tc1')).toBeUndefined();
        });

        it('set then take returns the edits exactly once', () => {
            dm.setAppliedEdits('tc1', edits);
            expect(dm.takeAppliedEdits('tc1')).toEqual(edits);
            expect(dm.takeAppliedEdits('tc1')).toBeUndefined();
        });

        it('isolates edits per tool_call_id', () => {
            const other = [{ startLine: 3, endLine: 3, oldContent: 'x', newContent: 'y' }];
            dm.setAppliedEdits('tc1', edits);
            dm.setAppliedEdits('tc2', other);
            expect(dm.takeAppliedEdits('tc2')).toEqual(other);
            expect(dm.takeAppliedEdits('tc1')).toEqual(edits);
        });

        it('clear() drops all stashed edits', () => {
            dm.setAppliedEdits('tc1', edits);
            dm.clear();
            expect(dm.takeAppliedEdits('tc1')).toBeUndefined();
        });
    });

    describe('full workflow: begin → write → finalize', () => {
        it('produces correct final content', () => {
            beginDraft(dm, {
                scopeId: 'project-1',
                name: 'analysis.md',
                title: 'Market Analysis',
                initialContent: '',
                is_internal: false,
                document_type: 'Report',
            });
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
            beginDraft(dm, { mode: 'edit', initialContent: 'Hello World\nFoo Bar\n', previousVersion: 1 });
            dm.searchReplace('Foo', 'Baz');
            const result = dm.finalize();
            expect(result.content).toBe('Hello World\nBaz Bar\n');
            expect(result.mode).toBe('edit');
            expect(result.previousVersion).toBe(1);
        });
    });
});
