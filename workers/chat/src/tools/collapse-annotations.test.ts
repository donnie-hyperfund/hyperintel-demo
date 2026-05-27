import { COLLAPSED_FIELD_SENTINEL, collapseHistoricalToolCalls } from '@common/ai/agent';
import type { ToolCallStreamBlock } from '@common/ai/agent/types';
import { describe, expect, it } from 'vitest';
import { createDocumentTools } from './documents';
import { createKnowledgeTools } from './knowledge-search';
import { createWebScrapeTools } from './web-scrape';

function getTool(tools: readonly any[], name: string) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
}

function collapseWithTool(tool: any, block: ToolCallStreamBlock): ToolCallStreamBlock {
    const [message] = collapseHistoricalToolCalls([{ role: 'assistant', content: '', blocks: [block] } as any], [tool]);
    return (message as any).blocks[0] as ToolCallStreamBlock;
}

function toolBlock(overrides: Partial<ToolCallStreamBlock>): ToolCallStreamBlock {
    return {
        id: overrides.toolCallId ?? 'call-1',
        type: 'tool_call',
        content: overrides.toolOutput ?? '',
        toolName: overrides.toolName ?? 'tool',
        toolInput: overrides.toolInput ?? {},
        toolCallId: overrides.toolCallId ?? 'call-1',
        toolOutput: overrides.toolOutput,
        toolSuccess: true,
        ...overrides,
    };
}

describe('tool collapse annotations', () => {
    it('collapses write_document input to __collapsedContent and injects recallHint on success', () => {
        const tool = getTool(createDocumentTools(), 'write_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'write_document',
                toolInput: { content: 'Large draft body' },
                toolOutput: JSON.stringify({ status: 'written', charsAdded: 16 }),
            }),
        );

        expect(collapsed.toolInput).toEqual({
            __collapsedContent: COLLAPSED_FIELD_SENTINEL,
            originalChars: 16,
        });
        expect(JSON.stringify(collapsed.toolInput)).not.toContain('Large draft body');
        expect(JSON.parse(collapsed.toolOutput ?? '')).toEqual({
            status: 'written',
            charsAdded: 16,
            recallHint: 'Use recall_tool_call to retrieve the original content.',
            toolCallId: 'call-1',
        });
    });

    it('collapses write_document input but preserves error output on failure', () => {
        const tool = getTool(createDocumentTools(), 'write_document');
        const errorOutput = JSON.stringify({ error: 'No active draft. Call begin_document first.' });
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'write_document',
                toolInput: { content: 'Large draft body' },
                toolOutput: errorOutput,
                toolSuccess: false,
            }),
        );

        expect(collapsed.toolInput).toEqual({
            __collapsedContent: COLLAPSED_FIELD_SENTINEL,
            originalChars: 16,
        });
        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output.error).toBe('No active draft. Call begin_document first.');
        expect(output.recallHint).toBeUndefined();
    });

    it('collapses patch_document edit bodies into deterministic stats', () => {
        const tool = getTool(createDocumentTools(), 'patch_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'patch_document',
                toolInput: {
                    edits: [
                        {
                            startLine: 10,
                            oldContent: 'old line 1\nold line 2',
                            newContent: 'new line',
                        },
                        {
                            startLine: 25,
                            oldContent: 'remove me',
                            newContent: 'replacement\nsecond line',
                        },
                    ],
                },
                toolOutput: JSON.stringify({ status: 'edited', editsApplied: 2 }),
            }),
        );

        expect(collapsed.toolInput).toEqual({
            editsCount: 2,
            edits: [
                {
                    startLine: 10,
                    oldContentLines: 2,
                    oldContentChars: 21,
                    newContentLines: 1,
                    newContentChars: 8,
                },
                {
                    startLine: 25,
                    oldContentLines: 1,
                    oldContentChars: 9,
                    newContentLines: 2,
                    newContentChars: 23,
                },
            ],
        });
        expect(JSON.stringify(collapsed.toolInput)).not.toContain('old line');
        expect(JSON.stringify(collapsed.toolInput)).not.toContain('replacement');
        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output).toMatchObject({
            status: 'edited',
            editsApplied: 2,
            recallHint: 'Use recall_tool_call to retrieve the original edits or touched-region content.',
        });
        expect(output.touched).toBeUndefined();
    });

    it('strips patch_document touched regions on collapse but keeps summary stats', () => {
        const tool = getTool(createDocumentTools(), 'patch_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'patch_document',
                toolInput: {
                    edits: [{ startLine: 10, oldContent: 'old', newContent: 'new' }],
                },
                toolOutput: JSON.stringify({
                    status: 'edited',
                    editsApplied: 1,
                    linesNow: 50,
                    touched: [{ startLine: 8, endLine: 12, content: '8: context\n9: old\n10: new' }],
                }),
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output.touched).toBeUndefined();
        expect(output.linesNow).toBe(50);
        expect(output.recallHint).toBe(
            'Use recall_tool_call to retrieve the original edits or touched-region content.',
        );
        expect(collapsed.toolOutput).not.toContain('8: context');
    });

    it('preserves patch_document truncated flag when touched is stripped on collapse', () => {
        const tool = getTool(createDocumentTools(), 'patch_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'patch_document',
                toolInput: { edits: [{ startLine: 1, oldContent: 'a', newContent: 'b' }] },
                toolOutput: JSON.stringify({
                    status: 'edited',
                    editsApplied: 1,
                    linesNow: 100,
                    truncated: true,
                    touched: [{ startLine: 1, endLine: 5, content: '1: a\n2: b' }],
                }),
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output.truncated).toBe(true);
        expect(output.touched).toBeUndefined();
        expect(output.recallHint).toContain('touched-region');
    });

    it('includes begin_document full draft content in live result and strips it on collapse', () => {
        const tool = getTool(createDocumentTools(), 'begin_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'begin_document',
                toolInput: { mode: 'edit', name: 'report.md', document_type: 'Other' },
                toolOutput: JSON.stringify({
                    status: 'editing',
                    mode: 'edit',
                    name: 'report.md',
                    lines: 2,
                    content: '1: first\n2: second',
                    message: 'Full draft included',
                }),
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output.content).toBeUndefined();
        expect(output).toMatchObject({
            contentCollapsed: true,
            contentLines: 2,
            contentChars: 18,
            recallHint: 'Use recall_tool_call to retrieve the loaded draft content.',
        });
        expect(collapsed.toolOutput).not.toContain('first');
    });

    it('leaves over-cap begin_document output unchanged on collapse', () => {
        const tool = getTool(createDocumentTools(), 'begin_document');
        const payload = {
            status: 'editing',
            mode: 'edit',
            name: 'big.md',
            lines: 900,
            message: 'Editing from approved v1. Make changes, then finalize_document.',
        };
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'begin_document',
                toolInput: { mode: 'edit', name: 'big.md', document_type: 'Other' },
                toolOutput: JSON.stringify(payload),
            }),
        );

        expect(JSON.parse(collapsed.toolOutput ?? '')).toEqual(payload);
    });

    it('collapses read_document output content but keeps document metadata', () => {
        const tool = getTool(createDocumentTools(), 'read_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'read_document',
                toolInput: { name: 'report.md', version: 'latest' },
                toolOutput: JSON.stringify({
                    source: 'approved',
                    name: 'report.md',
                    version: 3,
                    status: 'approved',
                    totalLines: 2,
                    viewport: { startLine: 1, endLine: 2 },
                    content: '1: first line\n2: second line',
                }),
                toolContentParts: [{ type: 'text', text: '1: first line\n2: second line' }],
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output).toMatchObject({
            source: 'approved',
            name: 'report.md',
            version: 3,
            status: 'approved',
            totalLines: 2,
            viewport: { startLine: 1, endLine: 2 },
            contentCollapsed: true,
            contentLines: 2,
            contentChars: 28,
        });
        expect(output.content).toBeUndefined();
        expect(collapsed.toolOutput).not.toContain('first line');
        expect(collapsed.toolContentParts).toBeUndefined();
    });

    it('collapses search_knowledge chunks into result headings', () => {
        const tool = getTool(createKnowledgeTools(), 'search_knowledge');
        const chunk = 'A'.repeat(600);
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'search_knowledge',
                toolInput: { query: 'market sizing', limit: 2, includeImages: true },
                toolOutput: [
                    `## Market Report (market.md)\n**Relevance:** 0.92\n\n${chunk}`,
                    `## Strategy Memo (strategy.md)\n**Relevance:** 0.84\n\n${chunk}`,
                ].join('\n\n---\n\n'),
                toolContentParts: [{ type: 'text', text: chunk }],
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output).toMatchObject({
            query: 'market sizing',
            limit: 2,
            includeImages: true,
            resultCount: 2,
            outputCollapsed: true,
            recallHint: 'Use recall_tool_call to retrieve the full search result chunks.',
            results: [
                { title: 'Market Report', key: 'market.md', relevance: '0.92' },
                { title: 'Strategy Memo', key: 'strategy.md', relevance: '0.84' },
            ],
        });
        expect(collapsed.toolOutput).not.toContain(chunk);
        expect(collapsed.toolContentParts).toBeUndefined();
    });

    it('counts search_knowledge headings even when result metadata format changes', () => {
        const tool = getTool(createKnowledgeTools(), 'search_knowledge');
        const chunk = 'A'.repeat(600);
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'search_knowledge',
                toolInput: { query: 'market sizing', limit: 2, includeImages: false },
                toolOutput: [
                    `## Market Report\nScore: 0.92\n\n${chunk}`,
                    `## Strategy Memo\nScore: 0.84\n\n${chunk}`,
                ].join('\n\n---\n\n'),
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output.resultCount).toBe(2);
        expect(output.results).toEqual([]);
        expect(collapsed.toolOutput).not.toContain(chunk);
    });

    it('collapses scrape_page body into title/source metadata', () => {
        const tool = getTool(createWebScrapeTools(), 'scrape_page');
        const body = 'Long page body. '.repeat(100);
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'scrape_page',
                toolInput: { url: 'https://example.com/report', format: 'markdown' },
                toolOutput: `# Example Report\n> Summary\n\n**Source:** https://example.com/report\n\n---\n\n${body}`,
            }),
        );

        const output = JSON.parse(collapsed.toolOutput ?? '');
        expect(output).toMatchObject({
            title: 'Example Report',
            source: 'https://example.com/report',
            format: 'markdown',
            outputCollapsed: true,
        });
        expect(output.originalChars).toBeGreaterThan(1000);
        expect(collapsed.toolOutput).not.toContain('Long page body');
    });
});
