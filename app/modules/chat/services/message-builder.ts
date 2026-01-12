import { v4 as uuidv4 } from 'uuid';
import type { Artifact, ArtifactMetadata, Message, MessageArtifactRef } from '../types';

/**
 * Generate a unique artifact ID
 */
export function generateArtifactId(identifier: string, messageId: string): string {
    return `${identifier}_${messageId}`.replace(/\s+/g, '_').toLowerCase();
}

/**
 * Create a new message object
 */
export function createMessage(role: 'user' | 'assistant', content: string, id?: string): Message {
    return {
        id: id ?? uuidv4(),
        role,
        content,
        createdAt: new Date(),
    };
}

/**
 * Create a new artifact from metadata and content
 */
export function createArtifact(messageId: string, metadata: ArtifactMetadata, content = ''): Artifact {
    return {
        id: generateArtifactId(metadata.identifier, messageId),
        identifier: metadata.identifier,
        title: metadata.title,
        type: metadata.type,
        content,
        messageId,
    };
}

/**
 * Update the last message in an array (immutably)
 */
export function updateLastMessage(messages: Message[], content: string): Message[] {
    if (messages.length === 0) return messages;

    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];

    return [...messages.slice(0, lastIndex), { ...lastMessage, content }];
}

/**
 * Append content to the last message (immutably)
 */
export function appendToLastMessage(messages: Message[], chunk: string): Message[] {
    if (messages.length === 0) return messages;

    const lastIndex = messages.length - 1;
    const lastMessage = messages[lastIndex];

    return [...messages.slice(0, lastIndex), { ...lastMessage, content: lastMessage.content + chunk }];
}

/**
 * MessageBuilder class for accumulating streamed content
 */
export class MessageBuilder {
    private content = '';
    private artifacts = new Map<string, { metadata: ArtifactMetadata; content: string }>();
    private artifactRefs: MessageArtifactRef[] = [];
    private currentArtifactId: string | null = null;

    constructor(private messageId: string) {}

    /**
     * Append text content
     */
    appendText(text: string): void {
        this.content += text;
    }

    /**
     * Start a new artifact
     */
    startArtifact(artifactId: string, metadata: ArtifactMetadata): void {
        this.currentArtifactId = artifactId;
        this.artifacts.set(artifactId, { metadata, content: '' });
        this.artifactRefs.push({
            id: artifactId,
            identifier: metadata.identifier,
            title: metadata.title,
        });
    }

    /**
     * Append content to current artifact
     */
    appendArtifactContent(artifactId: string, chunk: string): void {
        const artifact = this.artifacts.get(artifactId);
        if (artifact) {
            artifact.content += chunk;
        }
    }

    /**
     * End current artifact
     */
    endArtifact(artifactId: string): void {
        if (this.currentArtifactId === artifactId) {
            this.currentArtifactId = null;
        }
    }

    /**
     * Get the current text content
     */
    getText(): string {
        return this.content;
    }

    /**
     * Check if currently building an artifact
     */
    isInArtifact(): boolean {
        return this.currentArtifactId !== null;
    }

    /**
     * Get all completed artifacts
     */
    getArtifacts(): Artifact[] {
        return Array.from(this.artifacts.entries()).map(([id, { metadata, content }]) =>
            createArtifact(this.messageId, metadata, content),
        );
    }

    /**
     * Get a specific artifact's current content
     */
    getArtifact(artifactId: string): { metadata: ArtifactMetadata; content: string } | undefined {
        return this.artifacts.get(artifactId);
    }

    /**
     * Get artifact references (lightweight, no content)
     */
    getArtifactRefs(): MessageArtifactRef[] {
        return [...this.artifactRefs];
    }

    /**
     * Build the final message with artifact refs
     */
    buildMessage(): Message {
        return {
            id: this.messageId,
            role: 'assistant',
            content: this.content,
            artifacts: this.artifactRefs.length > 0 ? [...this.artifactRefs] : undefined,
            createdAt: new Date(),
        };
    }

    /**
     * Reset the builder
     */
    reset(): void {
        this.content = '';
        this.artifacts.clear();
        this.artifactRefs = [];
        this.currentArtifactId = null;
    }
}
