import type { Artifact } from '@/modules/chat/types';

const ARTIFACT_START = ':::artifact';
const ARTIFACT_END = ':::';

type ParsedArtifactMetadata = {
    identifier?: string;
    type?: string;
    title?: string;
};

/**
 * Parse artifact metadata from the opening tag
 * e.g. :::artifact{identifier="foo" type="text/markdown" title="Bar"}
 */
function parseArtifactMetadata(tagText: string): ParsedArtifactMetadata {
    const metadata: ParsedArtifactMetadata = {};
    const metaRegex = /(\w+)="([^"]*)"/g;
    let match: RegExpExecArray | null;

    while ((match = metaRegex.exec(tagText)) !== null) {
        const key = match[1] as keyof ParsedArtifactMetadata;
        metadata[key] = match[2];
    }

    return metadata;
}

/**
 * Extract content from inside the artifact block
 * Handles both fenced code blocks and raw content
 */
function extractArtifactContent(artifactBlock: string): string {
    // Try to find fenced code block content
    const codeBlockMatch = artifactBlock.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
        return codeBlockMatch[1];
    }

    // Fallback: extract content between opening tag and closing :::
    const openTagEnd = artifactBlock.indexOf('}');
    if (openTagEnd === -1) return '';

    const contentStart = artifactBlock.indexOf('\n', openTagEnd) + 1;
    const contentEnd = artifactBlock.lastIndexOf(ARTIFACT_END);

    if (contentStart === 0 || contentEnd === -1 || contentEnd <= contentStart) {
        return '';
    }

    return artifactBlock.substring(contentStart, contentEnd).trim();
}

export type ParsedArtifact = {
    fullText: string;
    startIndex: number;
    endIndex: number;
    metadata: ParsedArtifactMetadata;
    content: string;
};

/**
 * Find all artifact blocks in a text string
 */
export function findArtifacts(text: string): ParsedArtifact[] {
    const artifacts: ParsedArtifact[] = [];
    let currentIndex = 0;

    while (currentIndex < text.length) {
        const startIndex = text.indexOf(ARTIFACT_START, currentIndex);
        if (startIndex === -1) break;

        // Find the closing ::: (skip the opening one)
        const afterStart = startIndex + ARTIFACT_START.length;
        let endIndex = text.indexOf(ARTIFACT_END, afterStart);

        // Keep searching for closing ::: that's not part of a code block
        while (endIndex !== -1) {
            // Check if this ::: is at the start of a line (proper closing tag)
            const lineStart = text.lastIndexOf('\n', endIndex - 1) + 1;
            const beforeClosing = text.substring(lineStart, endIndex).trim();

            if (beforeClosing === '' || beforeClosing.endsWith('```')) {
                break;
            }
            endIndex = text.indexOf(ARTIFACT_END, endIndex + ARTIFACT_END.length);
        }

        if (endIndex === -1) {
            // No closing tag found, treat rest of text as artifact
            endIndex = text.length;
        } else {
            endIndex += ARTIFACT_END.length;
        }

        const fullText = text.substring(startIndex, endIndex);
        const openTagEnd = fullText.indexOf('}');
        const openTag = fullText.substring(0, openTagEnd + 1);
        const metadata = parseArtifactMetadata(openTag);
        const content = extractArtifactContent(fullText);

        artifacts.push({
            fullText,
            startIndex,
            endIndex,
            metadata,
            content,
        });

        currentIndex = endIndex;
    }

    return artifacts;
}

/**
 * Parse artifacts from message content and convert to Artifact objects
 */
export function parseArtifactsFromMessage(messageId: string, content: string): Artifact[] {
    const parsed = findArtifacts(content);

    return parsed
        .filter((p) => p.content && p.metadata.identifier)
        .map((p) => {
            const key = p.metadata.identifier ?? 'unknown';
            const title = p.metadata.title ?? 'Untitled';

            return {
                id: `${key}_${messageId}`.replace(/\s+/g, '_').toLowerCase(),
                key,
                title,
                proposed_version: {
                    id: '',
                    version: 1,
                    content: p.content,
                    status: 'proposed' as const,
                    created_at: new Date().toISOString(),
                },
            };
        });
}

/**
 * Strip artifact blocks from message content, leaving only the surrounding text
 */
export function stripArtifacts(text: string): string {
    const artifacts = findArtifacts(text);
    if (artifacts.length === 0) return text;

    let result = text;
    // Process in reverse order to maintain correct indices
    for (let i = artifacts.length - 1; i >= 0; i--) {
        const artifact = artifacts[i];
        result = result.substring(0, artifact.startIndex) + result.substring(artifact.endIndex);
    }

    return result.trim();
}
