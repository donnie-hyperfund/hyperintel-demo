// =============================================================================
// Chat Types
// =============================================================================

export type MessageArtifactRef = {
    id: string;
    identifier: string;
    title: string;
};

export type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    artifacts?: MessageArtifactRef[];
    createdAt?: Date;
};

export type Conversation = {
    id: string;
    messages: Message[];
    createdAt: Date;
    updatedAt: Date;
};

export type ChatState = {
    messages: Message[];
    isGenerating: boolean;
    error: Error | null;
    streamingMessageId: string | null;
};

// =============================================================================
// Artifact Types
// =============================================================================

export type ArtifactType = 'text/markdown';

export type Artifact = {
    id: string;
    identifier: string;
    title: string;
    type: ArtifactType;
    content: string;
    messageId: string;
};

export type ArtifactMetadata = {
    identifier: string;
    title: string;
    type: ArtifactType;
    language?: string;
};

// =============================================================================
// Streaming Types
// =============================================================================

export type StreamEventType = 'text' | 'artifact_start' | 'artifact_chunk' | 'artifact_end' | 'error' | 'done';

export type StreamEvent =
    | { type: 'text'; content: string }
    | { type: 'artifact_start'; artifactId: string; metadata: ArtifactMetadata }
    | { type: 'artifact_chunk'; artifactId: string; content: string }
    | { type: 'artifact_end'; artifactId: string }
    | { type: 'error'; error: string }
    | { type: 'done' };

export type StreamState = {
    isStreaming: boolean;
    error: Error | null;
};

export type StreamSubscriber = (event: StreamEvent) => void;

// =============================================================================
// SSE Parsing Types (for stream-parser service)
// =============================================================================

export type SSEMessage = {
    event?: string;
    data: string;
    id?: string;
    retry?: number;
};

export type ParsedSSEChunk = {
    messages: SSEMessage[];
    remainder: string;
};
