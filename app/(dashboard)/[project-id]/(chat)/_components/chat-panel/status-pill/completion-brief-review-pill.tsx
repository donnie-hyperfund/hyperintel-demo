'use client';

import { useAuth } from '@clerk/nextjs';
import { FileCheck } from 'lucide-react';
import { useCallback } from 'react';
import { createProjectArtifactApi } from '@/lib/api/client/fetchers/project-artifacts';
import { getCompletionBriefKey } from '@/lib/artifacts/utils';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { Pill } from './pill';
import { useProposedCompletionBrief } from './use-proposed-completion-brief';

const REVIEW_GRADIENT = 'linear-gradient(90deg, rgba(34,197,94,0.9), rgba(249,115,22,0.75), rgba(34,197,94,0.9))';

type CompletionBriefReviewPillProps = {
    className?: string;
};

export function CompletionBriefReviewPill({ className }: CompletionBriefReviewPillProps) {
    const { getToken } = useAuth();
    const {
        projectId,
        state: { phaseIndex },
    } = useChatContext();
    const { pushPanel } = useActivePanelContext();
    const { addArtifact } = useArtifactActions();
    const completionBriefKey = getCompletionBriefKey((phaseIndex ?? 0) + 1);
    const proposedCompletionBrief = useProposedCompletionBrief(completionBriefKey);

    const handleClick = useCallback(async () => {
        if (proposedCompletionBrief) {
            pushPanel(
                {
                    panel: 'artifact-preview',
                    artifactId: completionBriefKey,
                    version: proposedCompletionBrief.versionNumber,
                },
                { reset: true },
            );
            return;
        }

        if (!projectId) return;

        try {
            const fetched = await createProjectArtifactApi(getToken).getByKey(projectId, completionBriefKey);
            if (!fetched) return;

            const latestVersion = fetched.proposedVersion?.version ?? fetched.currentVersion?.version ?? 1;
            addArtifact(
                {
                    id: completionBriefKey,
                    key: fetched.key,
                    currentVersion: fetched.currentVersion ?? undefined,
                    proposedVersion: fetched.proposedVersion ?? undefined,
                    updatedAt: fetched.updatedAt,
                },
                latestVersion,
            );
            pushPanel(
                {
                    panel: 'artifact-preview',
                    artifactId: completionBriefKey,
                    version: latestVersion,
                },
                { reset: true },
            );
        } catch (error) {
            console.error('Failed to load completion brief', error);
        }
    }, [proposedCompletionBrief, completionBriefKey, projectId, getToken, addArtifact, pushPanel]);

    return (
        <Pill
            label="Review Completion Brief"
            icon={<FileCheck className="size-4 shrink-0" />}
            baseColor="rgb(21,128,61)"
            gradient={REVIEW_GRADIENT}
            onClick={handleClick}
            className={className}
        />
    );
}
