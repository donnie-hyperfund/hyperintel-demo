import { v4 as uuidv4 } from 'uuid';
import type { Artifact, ArtifactMetadata, Message, MessageArtifactRef } from '../types';

export function generateArtifactId(identifier: string, messageId: string): string {
    return `${identifier}_${messageId}`.replace(/\s+/g, '_').toLowerCase();
}

export function createMessage(role: 'user' | 'assistant', content: string, id?: string): Message {
    return {
        id: id ?? uuidv4(),
        role,
        content,
        createdAt: new Date(),
    };
}

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

export class MessageBuilder {
    private content = '';
    private artifacts = new Map<string, { metadata: ArtifactMetadata; content: string }>();
    private artifactRefs: MessageArtifactRef[] = [];
    private currentArtifactId: string | null = null;

    constructor(private messageId: string) {}

    appendText(text: string): void {
        this.content += text;
    }

    startArtifact(artifactId: string, metadata: ArtifactMetadata): void {
        this.currentArtifactId = artifactId;
        this.artifacts.set(artifactId, { metadata, content: '' });
        this.artifactRefs.push({
            id: artifactId,
            identifier: metadata.identifier,
            title: metadata.title,
        });
    }

    appendArtifactContent(artifactId: string, chunk: string): void {
        const artifact = this.artifacts.get(artifactId);
        if (artifact) {
            artifact.content += chunk;
        }
    }

    endArtifact(artifactId: string): void {
        if (this.currentArtifactId === artifactId) {
            this.currentArtifactId = null;
        }
    }

    getText(): string {
        return this.content;
    }

    isInArtifact(): boolean {
        return this.currentArtifactId !== null;
    }

    getArtifacts(): Artifact[] {
        return Array.from(this.artifacts.entries()).map(([id, { metadata, content }]) =>
            createArtifact(this.messageId, metadata, content),
        );
    }

    getArtifact(artifactId: string): { metadata: ArtifactMetadata; content: string } | undefined {
        return this.artifacts.get(artifactId);
    }

    getArtifactRefs(): MessageArtifactRef[] {
        return [...this.artifactRefs];
    }

    buildMessage(): Message {
        return {
            id: this.messageId,
            role: 'assistant',
            content: this.content,
            artifacts: this.artifactRefs.length > 0 ? [...this.artifactRefs] : undefined,
            createdAt: new Date(),
        };
    }

    reset(): void {
        this.content = '';
        this.artifacts.clear();
        this.artifactRefs = [];
        this.currentArtifactId = null;
    }
}
