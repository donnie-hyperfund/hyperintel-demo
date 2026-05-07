import type { ProcessingStage } from '@/modules/artifacts/processing/types';

type StageCopy = {
    headline: string;
    details: string[];
};

type ProgressAction = 'approve' | 'reject';

const APPROVE_STAGE_COPY: Record<ProcessingStage, StageCopy> = {
    queued: {
        headline: 'Starting approval',
        details: ['Sending your approval...', 'Getting the document ready...'],
    },
    saving: {
        headline: 'Saving approval',
        details: ['Updating the live document...', 'Recording the approved version...'],
    },
    publishing: {
        headline: 'Updating Project Intel',
        details: ['Making the approved document available...', 'Syncing the workspace...'],
    },
    indexing: {
        headline: 'Refreshing context',
        details: ['Updating what the workspace can reference...', 'Keeping the project context in sync...'],
    },
    finalizing: {
        headline: 'Wrapping things up',
        details: ['Confirming the update...', 'Almost done...'],
    },
};

const REJECT_STAGE_COPY: Record<ProcessingStage, StageCopy> = {
    queued: {
        headline: 'Starting rejection',
        details: ['Sending your rejection...', 'Getting the document ready...'],
    },
    saving: {
        headline: 'Saving rejection',
        details: ['Recording the rejected version...', 'Marking the change reverted...'],
    },
    publishing: {
        headline: 'Reverting workspace',
        details: ['Removing the rejected proposal...', 'Restoring the previous state...'],
    },
    indexing: {
        headline: 'Refreshing context',
        details: ['Updating what the workspace can reference...', 'Keeping the project context in sync...'],
    },
    finalizing: {
        headline: 'Wrapping things up',
        details: ['Confirming the rejection...', 'Almost done...'],
    },
};

export const STAGE_COPY: Record<ProgressAction, Record<ProcessingStage, StageCopy>> = {
    approve: APPROVE_STAGE_COPY,
    reject: REJECT_STAGE_COPY,
};
