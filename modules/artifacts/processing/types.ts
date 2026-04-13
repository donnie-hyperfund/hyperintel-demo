export type ProcessingAction = 'approve' | 'reject';
export type ProcessingStatus = 'processing' | 'completed' | 'failed';

export type ProcessingEntry = {
    versionId: string;
    artifactId: string;
    artifactName: string;
    artifactVersion: number;
    action: ProcessingAction;
    status: ProcessingStatus;
    projectId?: string;
    projectName?: string;
    phaseName?: string;
    phaseIndex?: number;
    chatId?: string;
    startedAt: number;
    /** Survives refresh via sessionStorage — only the initiating tab sends the nudge */
    initiatedLocally: boolean;
};
