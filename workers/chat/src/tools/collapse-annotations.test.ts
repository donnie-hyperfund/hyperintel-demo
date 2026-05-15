import { collapseHistoricalToolCalls } from '@common/ai/agent';
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
    it('collapses write_document input content', () => {
        const tool = getTool(createDocumentTools(), 'write_document');
        const collapsed = collapseWithTool(
            tool,
            toolBlock({
                toolName: 'write_document',
                toolInput: { content: 'Large draft body', other: 'kept' },
                toolOutput: JSON.stringify({ status: 'written', charsAdded: 16 }),
            }),
        );

        expect(collapsed.toolInput).toEqual({ other: 'kept' });
        expect(collapsed.toolOutput).toBe(JSON.stringify({ status: 'written', charsAdded: 16 }));
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
