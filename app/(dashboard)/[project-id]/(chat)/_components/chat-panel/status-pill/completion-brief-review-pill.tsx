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
    const { openPanel } = useActivePanelContext();
    const { addArtifact, updateArtifact, getArtifact } = useArtifactActions();

    const handleClick = useCallback(async () => {
        const cbKey = getCompletionBriefKey((phaseIndex ?? 0) + 1);
        const cbVersion = 1;

        const cached = getArtifact(cbKey, cbVersion);
        if (cached) {
            openPanel({ panel: 'artifact-preview', artifactId: cbKey, version: cbVersion });
            return;
        }

        addArtifact({ id: cbKey, key: cbKey, isLoading: true }, cbVersion);
        openPanel({ panel: 'artifact-preview', artifactId: cbKey, version: cbVersion });

        try {
            const fetched = projectId
                ? await createProjectArtifactApi(getToken).getByKey(projectId, cbKey, cbVersion)
                : null;

            if (fetched) {
                updateArtifact(
                    cbKey,
                    {
                        key: fetched.key,
                        currentVersion: fetched.currentVersion ?? undefined,
                        proposedVersion: fetched.proposedVersion ?? undefined,
                        updatedAt: fetched.updatedAt,
                        isLoading: false,
                    },
                    cbVersion,
                );
            } else {
                updateArtifact(cbKey, { isLoading: false }, cbVersion);
            }
        } catch {
            updateArtifact(cbKey, { isLoading: false }, cbVersion);
        }
    }, [phaseIndex, getArtifact, addArtifact, updateArtifact, openPanel, projectId, getToken]);

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
