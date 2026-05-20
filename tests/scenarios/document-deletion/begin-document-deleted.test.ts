/**
 * begin_document tool behavior with deleted artifacts.
 *
 * Tests that create/edit modes handle deleted documents correctly:
 * - create: allows overwriting deleted docs, flags previouslyDeleted
 * - edit: loads deleted content, labels as 'deleted', flags previouslyDeleted
 *
 * Uses mocked document-service (no DB needed).
 */

import type { EntityManager } from '@mikro-orm/core';
import type { DocumentInfo } from '@/workers/chat/src/tools/documents/document-service';
import { DraftManager } from '@/workers/chat/src/tools/documents/draft-manager';
import { createDocumentTools, type DocumentToolsContext } from '@/workers/chat/src/tools/documents/tools';
import { getToolResult } from '@/tests/helpers/tool-result';

// -- mocks --------------------------------------------------------------------

const mockFindDocumentByName = vi.fn<() => Promise<DocumentInfo | null>>();

vi.mock('@/workers/chat/src/tools/documents/document-service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/workers/chat/src/tools/documents/document-service')>();
    return {
        ...actual,
        findDocumentByName: (...args: any[]) => mockFindDocumentByName(),
    };
});

// -- fixtures -----------------------------------------------------------------

function makeDocInfo(overrides: Partial<DocumentInfo> = {}): DocumentInfo {
    return {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'test-doc.md',
        title: 'Test Doc',
        currentVersion: 1,
        currentContent: '# Original content',
        currentStatus: 'approved',
        currentDocumentType: 'Other',
        currentIsInternal: null,
        approvedVersion: 1,
        approvedContent: '# Original content',
        approvedDocumentType: 'Other',
        approvedIsInternal: null,
        latestVersion: 1,
        proposedVersion: null,
        proposedContent: null,
        proposedDocumentType: null,
        proposedIsInternal: null,
        rejectedVersion: null,
        rejectedContent: null,
        rejectedDocumentType: null,
        rejectedIsInternal: null,
        rejectionReason: null,
        lineCount: 1,
        isReadOnly: false,
        ...overrides,
    };
}

function deletedDocInfo(overrides: Partial<DocumentInfo> = {}): DocumentInfo {
    return makeDocInfo({
        currentStatus: 'deleted',
        ...overrides,
    });
}

function makeCtx(draftManager?: DraftManager): DocumentToolsContext {
    return {
        em: {} as EntityManager,
        projectId: 'proj-1',
        chatId: 'chat-1',
        draftManager: draftManager ?? new DraftManager(),
        createdVersionIds: [],
    };
}

// -- setup --------------------------------------------------------------------

const tools = createDocumentTools();
const beginDocument = tools.find((t) => t.name === 'begin_document')!;

beforeEach(() => {
    mockFindDocumentByName.mockReset();
});

// -- tests: create mode on deleted artifact -----------------------------------

describe('begin_document create mode on deleted artifact', () => {
    it('allows overwrite with previouslyDeleted flag and empty content', async () => {
        mockFindDocumentByName.mockResolvedValue(deletedDocInfo());
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'create', name: 'test-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(result).not.toHaveProperty('error');
        expect(result).toHaveProperty('status', 'editing');
        expect(result).toHaveProperty('mode', 'create');
        expect(result).toHaveProperty('previouslyDeleted', true);
        expect((result as any).message).toContain('deleted');
        expect(ctx.draftManager.getCurrent()?.content).toBe('');
    });

    it('still blocks create on non-deleted existing artifact', async () => {
        mockFindDocumentByName.mockResolvedValue(makeDocInfo());
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'create', name: 'test-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(result).toHaveProperty('error');
        expect((result as any).error).toContain('already exists');
    });
});

describe('begin_document create mode on new document', () => {
    it('does not include previouslyDeleted flag', async () => {
        mockFindDocumentByName.mockResolvedValue(null);
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'create', name: 'new-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(result).not.toHaveProperty('previouslyDeleted');
        expect(result).toHaveProperty('status', 'editing');
    });
});

// -- tests: edit mode on deleted artifact -------------------------------------

describe('begin_document edit mode on deleted artifact', () => {
    it('loads deleted content with correct labeling and flags', async () => {
        const content = '# Deleted document body';
        mockFindDocumentByName.mockResolvedValue(
            deletedDocInfo({
                currentContent: content,
                currentVersion: 3,
                approvedContent: content,
                approvedVersion: 3,
            }),
        );
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'edit', name: 'test-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(ctx.draftManager.getCurrent()?.content).toBe(content);
        expect(result).toHaveProperty('loadedFrom', 'deleted');
        expect(result).toHaveProperty('previouslyDeleted', true);
        expect((result as any).message).toContain('deleted');
        expect((result as any).message).toContain('v3');
    });

    it('prefers proposed over deleted current_version', async () => {
        mockFindDocumentByName.mockResolvedValue(
            deletedDocInfo({
                proposedVersion: 2,
                proposedContent: '# Proposed content',
            }),
        );
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'edit', name: 'test-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(result).toHaveProperty('loadedFrom', 'proposed');
        expect(ctx.draftManager.getCurrent()?.content).toBe('# Proposed content');
    });

    it('prefers rejected over deleted current_version', async () => {
        mockFindDocumentByName.mockResolvedValue(
            deletedDocInfo({
                rejectedVersion: 2,
                rejectedContent: '# Rejected content',
                rejectionReason: 'Needs work',
            }),
        );
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'edit', name: 'test-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(result).toHaveProperty('loadedFrom', 'rejected');
        expect(ctx.draftManager.getCurrent()?.content).toBe('# Rejected content');
    });
});

// -- tests: edit mode on approved artifact (no deleted flag) -------------------

describe('begin_document edit mode on approved artifact', () => {
    it('does not include previouslyDeleted flag', async () => {
        mockFindDocumentByName.mockResolvedValue(makeDocInfo());
        const ctx = makeCtx();

        const result = getToolResult(await beginDocument.executor(
            { mode: 'edit', name: 'test-doc.md', document_type: 'Other' },
            ctx,
        ));

        expect(result).not.toHaveProperty('previouslyDeleted');
        expect(result).toHaveProperty('loadedFrom', 'approved');
    });
});
