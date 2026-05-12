import { type Change, diffLines } from 'diff';

export type DiffChangeType = 'added' | 'removed' | 'unchanged';

export type DiffLine = {
    type: DiffChangeType;
    content: string;
    isTable?: boolean;
    isCodeBlock?: boolean;
};

export type DiffBlock = {
    type: DiffChangeType;
    content: string;
};

export type DiffResult = {
    blocks: DiffBlock[];
    hasChanges: boolean;
    stats: {
        added: number;
        removed: number;
        unchanged: number;
    };
};

/**
 * Check if a line is part of a markdown table
 */
function isTableLine(line: string): boolean {
    return line.trim().startsWith('|');
}

/**
 * Check if a line starts or is inside a fenced code block
 */
function isCodeFence(line: string): boolean {
    return /^(`{3,}|~{3,})/.test(line);
}

/**
 * Parse diff changes into lines with table/code block markers
 */
function parseChangesToLines(changes: Change[]): DiffLine[] {
    const lines: DiffLine[] = [];
    let inCodeBlock = false;

    for (const change of changes) {
        const type: DiffChangeType = change.added ? 'added' : change.removed ? 'removed' : 'unchanged';
        const changeLines = change.value.split('\n');

        // Remove trailing empty string from split
        if (changeLines[changeLines.length - 1] === '') {
            changeLines.pop();
        }

        for (const content of changeLines) {
            // Track code block state
            if (isCodeFence(content)) {
                inCodeBlock = !inCodeBlock;
            }

            lines.push({
                type,
                content,
                isTable: isTableLine(content),
                isCodeBlock: inCodeBlock || isCodeFence(content),
            });
        }
    }

    return lines;
}

/**
 * Find the boundaries of a table containing the given line index
 */
function findTableBoundaries(lines: DiffLine[], startIdx: number): { start: number; end: number } {
    let start = startIdx;
    let end = startIdx;

    // Find start of table
    while (start > 0 && lines[start - 1].isTable) {
        start--;
    }

    // Find end of table
    while (end < lines.length - 1 && lines[end + 1].isTable) {
        end++;
    }

    return { start, end };
}

/**
 * Check if a table region contains any changes
 */
function tableHasChanges(lines: DiffLine[], start: number, end: number): boolean {
    for (let i = start; i <= end; i++) {
        if (lines[i].type !== 'unchanged') {
            return true;
        }
    }
    return false;
}

/**
 * Process tables with changes - reconstruct full old and new tables
 */
function processTablesWithChanges(lines: DiffLine[]): DiffLine[] {
    const result: DiffLine[] = [];
    const processedIndices = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
        if (processedIndices.has(i)) {
            continue;
        }

        const line = lines[i];

        // If this is a table line, check if the table has changes
        if (line.isTable) {
            const { start, end } = findTableBoundaries(lines, i);

            // Mark all indices in this table as processed
            for (let j = start; j <= end; j++) {
                processedIndices.add(j);
            }

            if (tableHasChanges(lines, start, end)) {
                // Reconstruct old table (removed + unchanged lines)
                const oldTableLines: string[] = [];
                for (let j = start; j <= end; j++) {
                    if (lines[j].type === 'removed' || lines[j].type === 'unchanged') {
                        oldTableLines.push(lines[j].content);
                    }
                }

                // Reconstruct new table (added + unchanged lines)
                const newTableLines: string[] = [];
                for (let j = start; j <= end; j++) {
                    if (lines[j].type === 'added' || lines[j].type === 'unchanged') {
                        newTableLines.push(lines[j].content);
                    }
                }

                // Add old table as removed (if it has content)
                if (oldTableLines.length > 0) {
                    for (const content of oldTableLines) {
                        result.push({ type: 'removed', content, isTable: true });
                    }
                }

                // Add new table as added (if it has content)
                if (newTableLines.length > 0) {
                    for (const content of newTableLines) {
                        result.push({ type: 'added', content, isTable: true });
                    }
                }
            } else {
                // No changes in this table, keep as unchanged
                for (let j = start; j <= end; j++) {
                    result.push(lines[j]);
                }
            }
        } else {
            // Non-table line, keep as is
            result.push(line);
        }
    }

    return result;
}

/**
 * Merge consecutive lines of the same type into blocks
 */
function mergeIntoBlocks(lines: DiffLine[]): DiffBlock[] {
    const blocks: DiffBlock[] = [];
    let currentBlock: DiffBlock | null = null;

    for (const line of lines) {
        if (!currentBlock || currentBlock.type !== line.type) {
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            currentBlock = { type: line.type, content: line.content };
        } else {
            currentBlock.content += `\n${line.content}`;
        }
    }

    if (currentBlock) {
        blocks.push(currentBlock);
    }

    return blocks;
}

/**
 * Compute diff between two markdown strings.
 * Tables are treated as atomic units - if any line changes,
 * the entire old table is shown as removed and entire new table as added.
 */
export function computeDiff(oldContent: string, newContent: string): DiffResult {
    const changes = diffLines(oldContent, newContent);

    // Parse into lines with markers
    const lines = parseChangesToLines(changes);

    // Process tables with changes - reconstruct full tables
    const processedLines = processTablesWithChanges(lines);

    // Merge into blocks
    const blocks = mergeIntoBlocks(processedLines);

    // Calculate stats
    const stats = { added: 0, removed: 0, unchanged: 0 };
    for (const line of processedLines) {
        if (line.type === 'added') stats.added++;
        else if (line.type === 'removed') stats.removed++;
        else stats.unchanged++;
    }

    return {
        blocks,
        hasChanges: stats.added > 0 || stats.removed > 0,
        stats,
    };
}

/**
 * Convert diff result to markdown with diff directives.
 * Added content is wrapped in :::diff-added directives.
 * Removed content is wrapped in :::diff-removed directives.
 * Unchanged content is left as-is.
 */
export function diffToMarkdownWithDirectives(diff: DiffResult): string {
    const parts: string[] = [];

    for (const block of diff.blocks) {
        const content = block.content.trim();
        if (!content) continue;

        if (block.type === 'added') {
            parts.push(`:::diff-added\n${content}\n:::`);
        } else if (block.type === 'removed') {
            parts.push(`:::diff-removed\n${content}\n:::`);
        } else {
            parts.push(content);
        }
    }

    return parts.join('\n\n');
}

export type DiffData = {
    /** Markdown content with diff directives for rendering */
    markdownWithDiff: string;
    /** Whether there are any changes */
    hasChanges: boolean;
    /** Stats about the diff */
    stats: DiffResult['stats'];
};

/**
 * Compute diff and return markdown with directives ready for rendering.
 * This is the main function to use for diffing artifacts.
 */
export function computeDiffWithDirectives(oldContent: string, newContent: string): DiffData {
    const diff = computeDiff(oldContent, newContent);

    return {
        markdownWithDiff: diffToMarkdownWithDirectives(diff),
        hasChanges: diff.hasChanges,
        stats: diff.stats,
    };
}
