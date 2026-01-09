export type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
};

export type Artifact = {
    id: string;
    identifier: string;
    title: string;
    type: 'text/markdown';
    content: string;
    messageId: string;
};

export type ArtifactContextValue = {
    artifacts: Record<string, Artifact>;
    currentArtifactId: string | null;
    isVisible: boolean;
    addArtifact: (artifact: Artifact) => void;
    setCurrentArtifact: (id: string | null) => void;
    togglePanel: (visible?: boolean) => void;
};
