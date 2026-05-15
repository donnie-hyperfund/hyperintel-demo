export type ChatStreamLocation = {
    domain: 'chat' | 'intake';
    chatType?: 'phase' | 'company' | 'stakeholder';
    projectId?: string;
    projectName?: string | null;
    phaseName?: string | null;
    phaseIndex?: number | null;
};

export type ArtifactStreamMode = 'create' | 'edit' | 'replace';

export type ActiveArtifactPreviewTarget = {
    artifactId: string;
    artifactKey: string;
    version: number;
};

export type ActiveArtifactStream = {
    chatId: string;
    artifactId: string;
    artifactKey: string;
    artifactName: string;
    version: number;
    isInternal: boolean;
    mode: ArtifactStreamMode;
    previousVersion?: number;
    hasSummary: boolean;
    previewTarget: ActiveArtifactPreviewTarget | null;
    location: ChatStreamLocation;
};
