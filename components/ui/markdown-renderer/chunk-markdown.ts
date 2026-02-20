import type { Root } from 'mdast';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const TARGET_CHUNK_SIZE = 2000;

export interface MarkdownChunk {
    content: string;
    sourceOffset: number;
    /** Bytes prepended that aren't from the original source position (table headers) */
    prefixLength: number;
}

export function chunkMarkdown(markdown: string): MarkdownChunk[] {
    const tree = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath, { singleDollarTextMath: false })
        .use(remarkDirective)
        .parse(markdown) as Root;

    const chunks: MarkdownChunk[] = [];
    let currentStart: number | null = null;
    let currentEnd = 0;
    let currentSize = 0;
    let lastChunkEnd = 0;

    function flush() {
        if (currentStart !== null) {
            chunks.push({
                content: markdown.slice(currentStart, currentEnd),
                sourceOffset: currentStart,
                prefixLength: 0,
            });
            lastChunkEnd = currentEnd;
        }
        currentStart = null;
        currentSize = 0;
    }

    function pushChunk(start: number, end: number) {
        chunks.push({
            content: markdown.slice(start, end),
            sourceOffset: start,
            prefixLength: 0,
        });
        lastChunkEnd = end;
    }

    for (const node of tree.children) {
        if (!node.position) continue;
        const start = node.position.start.offset!;
        const end = node.position.end.offset!;
        const size = end - start;

        if (size > TARGET_CHUNK_SIZE && 'children' in node && (node as any).children.length > 1) {
            flush();

            if (node.type === 'table') {
                const rows = (node as any).children;
                const headerEnd = rows.length > 1 ? rows[1].position!.end.offset! : rows[0].position!.end.offset!;
                const gapBefore = markdown.slice(lastChunkEnd, start);
                const headerStr = gapBefore + markdown.slice(start, headerEnd);

                let subStart = headerEnd;
                let subSize = 0;

                for (let i = 2; i < rows.length; i++) {
                    const rowStart = rows[i].position!.start.offset!;
                    const rowEnd = rows[i].position!.end.offset!;
                    const rowSize = rowEnd - rowStart;

                    if (subSize > 0 && subSize + rowSize > TARGET_CHUNK_SIZE) {
                        pushChunk(subStart, rowStart);
                        const last = chunks[chunks.length - 1];
                        last.content = headerStr + '\n' + last.content;
                        last.prefixLength = headerStr.length + 1;
                        subStart = rowStart;
                        subSize = 0;
                    }
                    subSize += rowSize;
                }
                if (subStart < end) {
                    pushChunk(subStart, end);
                    const last = chunks[chunks.length - 1];
                    last.content = headerStr + '\n' + last.content;
                    last.prefixLength = headerStr.length + 1;
                }
                continue;
            }

            let subStart: number | null = null;
            let subEnd = 0;
            let subSize = 0;
            let subLastEnd = lastChunkEnd;

            for (const child of (node as any).children) {
                if (!child.position) continue;
                const cs = child.position.start.offset!;
                const ce = child.position.end.offset!;
                const childSize = ce - cs;

                if (subSize > 0 && subSize + childSize > TARGET_CHUNK_SIZE) {
                    pushChunk(subStart!, subEnd);
                    subLastEnd = subEnd;
                    subStart = null;
                    subSize = 0;
                }

                if (subStart === null) subStart = subLastEnd;
                subEnd = ce;
                subSize += childSize;
            }
            if (subStart !== null) {
                pushChunk(subStart, subEnd);
            }
            continue;
        }

        if (currentSize > 0 && currentSize + size > TARGET_CHUNK_SIZE) {
            flush();
        }

        if (currentStart === null) {
            currentStart = lastChunkEnd;
        }
        currentEnd = end;
        currentSize += size;
    }

    if (currentStart !== null) {
        currentEnd = markdown.length;
        flush();
    } else if (lastChunkEnd < markdown.length) {
        const trailing = markdown.slice(lastChunkEnd);
        if (trailing.trim().length === 0 && chunks.length > 0) {
            chunks[chunks.length - 1].content += trailing;
        } else if (trailing.trim().length > 0) {
            pushChunk(lastChunkEnd, markdown.length);
        }
    }

    return chunks;
}
