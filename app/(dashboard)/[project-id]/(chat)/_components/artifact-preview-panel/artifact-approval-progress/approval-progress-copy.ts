import type { ProcessingStage } from '@/modules/artifacts/processing/types';

type StageCopy = {
    headline: string;
    details: string[];
};

export const APPROVAL_STAGE_COPY: Record<ProcessingStage, StageCopy> = {
    queued: {
        headline: 'Starting approval',
        details: ['Sending your approval...', 'Getting the document ready...'],
    },
    classifying: {
        headline: 'Preparing approval',
        details: ['Reviewing the document...', 'Setting up the approved version...'],
    },
    'generating-ai-content': {
        headline: 'Preparing approved version',
        details: [
            'Organizing the document for the workspace...',
            'Keeping the important context available...',
            'Preparing the final approved state...',
        ],
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
