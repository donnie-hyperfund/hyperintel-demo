export type ChatStreamLocation = {
    domain: 'chat' | 'intake';
    chatType?: 'phase' | 'company' | 'stakeholder';
    projectId?: string;
    phaseName?: string | null;
    phaseIndex?: number | null;
};

export type ActiveArtifactStream = {
    chatId: string;
    artifactKey: string;
    artifactName: string;
    version: number;
    location: ChatStreamLocation;
};
