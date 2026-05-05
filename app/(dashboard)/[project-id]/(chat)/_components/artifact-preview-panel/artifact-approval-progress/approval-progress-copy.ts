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
            'Reading through the document...',
            'Organizing the important details...',
            'Getting the approved version ready...',
            'Checking the document structure...',
            'Preserving the key points...',
            'Preparing the details for later use...',
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
