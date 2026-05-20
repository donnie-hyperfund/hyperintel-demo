/** VIBE CODED
 * Web Scrape Tool
 *
 * Uses Firecrawl to scrape web pages and return content as markdown or HTML.
 * This is for visiting specific URLs, not searching the web.
 */

import type { AgentToolGroup } from '@common/ai/agent/tool-groups';
import type { ToolCallStreamBlock } from '@common/ai/agent/types';
import { z } from 'zod';
import type { Ctx } from '../context';

// ============================================================================
// TYPES
// ============================================================================

export interface WebScrapeContext {
    // No longer needs firecrawl - accessed via eCtx
}

// ============================================================================
// TOOL GROUP
// ============================================================================

export const WebScrapeToolGroup: AgentToolGroup = {
    slug: 'scrape',
    name: 'Web Scrape',
    description: 'Tools for fetching and reading web page content.',
    guidance:
        'Use scrape_page to visit and read a specific URL. Use this when you have a URL and need to see its content. For searching the web without a specific URL, use web_search instead.',
    tools: ['scrape_page'],
};

// ============================================================================
// SCHEMAS
// ============================================================================

const ScrapePageParams = z.object({
    // TODO openai can't do url format..
    url: z.string().url().describe('The URL to scrape.'),
    format: z
        .enum(['markdown', 'html'])
        .default('markdown')
        .describe('Output format: "markdown" for clean readable text, "html" for raw HTML.'),
});

function collapseScrapePage(block: ToolCallStreamBlock): { toolOutput?: string } {
    const output = block.toolOutput;
    if (typeof output !== 'string' || output.length < 1000) return {};

    const title = output.match(/^#\s+(.+)$/m)?.[1] ?? 'Untitled';
    const source = output.match(/^\*\*Source:\*\*\s+(.+)$/m)?.[1];
    const input = block.toolInput as { url?: unknown; format?: unknown } | undefined;

    return {
        toolOutput: JSON.stringify({
            title,
            source: source ?? (typeof input?.url === 'string' ? input.url : undefined),
            format: input?.format,
            outputCollapsed: true,
            originalChars: output.length,
            recallHint: 'Use recall_tool_call with this tool_call_id to retrieve the full scraped page content.',
        }),
    };
}

// ============================================================================
// TOOL FACTORY
// ============================================================================

export function createWebScrapeTools() {
    return [
        {
            name: 'scrape_page' as const,
            description:
                'Fetch and read the content of a web page. Returns the page content in the specified format (markdown or HTML). Use this when you have a specific URL to visit.',
            parameters: ScrapePageParams,
            collapseResult: collapseScrapePage,
            executor: async (
                input: z.infer<typeof ScrapePageParams>,
                _ctx: WebScrapeContext,
                eCtx?: Ctx,
            ): Promise<string> => {
                if (!eCtx?.firecrawl) {
                    return 'Web scraping is not available - Firecrawl client not configured.';
                }

                const { url, format = 'markdown' } = input;

                try {
                    const result = await eCtx.firecrawl.scrape(url, {
                        formats: [format],
                    });

                    const content = format === 'markdown' ? result.markdown : result.html;

                    if (!content) {
                        return `Page scraped but no ${format} content returned.`;
                    }

                    // Include metadata for context
                    const metadata = result.metadata;
                    const title = metadata?.title || 'Untitled';
                    const description = metadata?.description || '';

                    let output = `# ${title}\n`;
                    if (description) {
                        output += `> ${description}\n\n`;
                    }
                    output += `**Source:** ${url}\n\n---\n\n`;
                    output += content;

                    // Truncate if too long to avoid token explosion
                    const MAX_LENGTH = 50000;
                    if (output.length > MAX_LENGTH) {
                        output = `${output.slice(0, MAX_LENGTH)}\n\n... [Content truncated]`;
                    }

                    return output;
                } catch (error: any) {
                    return `Error scraping page: ${error.message || String(error)}`;
                }
            },
        },
    ] as const;
}

export const webScrapeTools = createWebScrapeTools();
