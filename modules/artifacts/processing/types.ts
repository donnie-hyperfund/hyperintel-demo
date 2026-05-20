import type { ArtifactProcessingStage } from '@/lib/schema/user-events';

export type ApprovalAction = 'approve' | 'reject';
export type ProcessingAction = ApprovalAction | 'restore';
export type ProcessingStatus = 'processing' | 'completed' | 'failed';
export type ProcessingStage = ArtifactProcessingStage;

type BaseProcessingEntry = {
    versionId: string;
    artifactId: string;
    artifactName: string;
    status: ProcessingStatus;
    projectId?: string;
    projectName?: string;
    phaseName?: string;
    phaseIndex?: number;
    chatId?: string;
    startedAt: number;
    completedAt?: number;
    progress?: number;
    stage?: ProcessingStage;
    stageStartedAt?: number;
    /** Survives refresh via sessionStorage — only the initiating tab sends the nudge */
    initiatedLocally: boolean;
};

export type ApprovalProcessingEntry = BaseProcessingEntry & {
    action: ApprovalAction;
    artifactVersion: number;
};

export type RestoreProcessingEntry = BaseProcessingEntry & {
    action: 'restore';
    sourceVersionNumber: number;
    restoredVersionNumber?: number;
};

export type ProcessingEntry = ApprovalProcessingEntry | RestoreProcessingEntry;

export type ProcessingEntryInput<E extends ProcessingEntry = ProcessingEntry> = E extends ProcessingEntry
    ? Omit<E, 'status' | 'startedAt' | 'initiatedLocally'>
    : never;
