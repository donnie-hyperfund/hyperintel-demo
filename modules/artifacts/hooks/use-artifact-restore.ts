'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useFetchChat } from '@/lib/api/client/hooks/use-chats';
import { useRestoreProjectArtifactVersion } from '@/lib/api/client/hooks/use-project-artifacts';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type UseArtifactRestoreOptions = {
    artifactKey: string;
    artifactId: string;
};

type RedirectState = {
    open: boolean;
    chatId: string | null;
    pendingNavigation: boolean;
};

const REDIRECT_IDLE: RedirectState = { open: false, chatId: null, pendingNavigation: false };

export function useArtifactRestore({ artifactKey, artifactId }: UseArtifactRestoreOptions) {
    const router = useRouter();
    const chatContext = useChatContext();
    const { chatId, setProcessingArtifactAction, state: chatState } = chatContext;
    const projectId = chatContext.chatType === 'phase' ? chatContext.projectId : undefined;
    const { addArtifact } = useArtifactActions();
    const { pushPanel } = useActivePanelContext();
    const { startProcessing, failProcessing, isAnyActionProcessing } = useArtifactProcessing();
    const { data: project } = useFetchProject(projectId);
    const { data: chat } = useFetchChat(projectId, chatId ?? undefined);

    const { trigger: restoreVersion, isMutating: isRestoring } = useRestoreProjectArtifactVersion(
        projectId,
        artifactKey,
    );

    // Cross-phase redirect state (project-only — intake always nudges directly).
    const [redirect, setRedirect] = useState<RedirectState>(REDIRECT_IDLE);
    const isAnotherRestoreActive = isAnyActionProcessing('restore');

    const restore = useCallback(
        async (opts: { sourceVersionId: string; sourceVersionNumber: number }) => {
            if (chatState.isGenerating || chatState.isProcessingArtifactAction || isAnyActionProcessing('restore')) {
                toast({ title: 'Another action is in progress, please wait', variant: 'destructive' });
                return;
            }

            setProcessingArtifactAction(true);
            startProcessing({
                versionId: opts.sourceVersionId,
                artifactId,
                artifactName: artifactKey,
                action: 'restore',
                sourceVersionNumber: opts.sourceVersionNumber,
                projectId,
                projectName: project?.name,
                phaseName: chat?.name ?? undefined,
                phaseIndex: chatState.phaseIndex ?? undefined,
                chatId: chatId ?? undefined,
            });

            try {
                const updatedArtifact = await restoreVersion({ sourceVersionId: opts.sourceVersionId });
                const restoredVersion = updatedArtifact.version;

                addArtifact(
                    {
                        ...updatedArtifact,
                        id: updatedArtifact.id,
                        isLoading: false,
                        isStreaming: false,
                        isUpdating: false,
                    },
                    restoredVersion,
                );
                pushPanel(
                    {
                        panel: 'artifact-preview',
                        artifactId: updatedArtifact.id,
                        artifactKey: updatedArtifact.key || artifactKey,
                        version: restoredVersion,
                    },
                    { reset: true },
                );

                toast({
                    title: `Restored v${opts.sourceVersionNumber} as proposed v${restoredVersion} — awaiting approval`,
                });

                const targetChatId = updatedArtifact.chatId;
                if (targetChatId && targetChatId !== chatId) {
                    setRedirect({ open: true, chatId: targetChatId, pendingNavigation: false });
                }
            } catch (error) {
                console.error('Failed to restore artifact version:', error);
                failProcessing(opts.sourceVersionId);
                toast({
                    title: error instanceof Error ? error.message : 'Failed to restore version',
                    variant: 'destructive',
                });
                throw error;
            } finally {
                setProcessingArtifactAction(false);
            }
        },
        [
            chatState.isGenerating,
            chatState.isProcessingArtifactAction,
            chatState.phaseIndex,
            isAnyActionProcessing,
            startProcessing,
            failProcessing,
            setProcessingArtifactAction,
            artifactId,
            artifactKey,
            projectId,
            project?.name,
            chat?.name,
            chatId,
            restoreVersion,
            addArtifact,
            pushPanel,
        ],
    );

    const confirmRedirect = useCallback(() => {
        setRedirect((prev) => ({ ...prev, open: false, pendingNavigation: true }));
    }, []);

    useEffect(() => {
        if (!redirect.pendingNavigation || redirect.open || !redirect.chatId) return;
        setRedirect(REDIRECT_IDLE);
        router.push(`/${projectId}/${redirect.chatId}`);
    }, [redirect, router, projectId]);

    return {
        restore,
        isRestoring,
        isGenerating: chatState.isGenerating,
        isAnotherRestoreActive,
        redirectDialog: {
            open: redirect.open,
            onConfirm: confirmRedirect,
        },
    };
}
