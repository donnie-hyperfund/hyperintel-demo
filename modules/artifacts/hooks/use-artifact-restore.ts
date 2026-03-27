'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useRestoreProjectArtifactVersion } from '@/lib/api/client/hooks/use-project-artifacts';
import { SEARCH_PARAMS } from '@/lib/search-params';
import { useArtifactActions } from '@/modules/artifacts/providers/artifact-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type UseArtifactRestoreOptions = {
    artifactKey: string;
};

type RedirectState = {
    open: boolean;
    chatId: string | null;
    pendingNavigation: boolean;
};

const REDIRECT_IDLE: RedirectState = { open: false, chatId: null, pendingNavigation: false };

export function useArtifactRestore({ artifactKey }: UseArtifactRestoreOptions) {
    const router = useRouter();
    const chatContext = useChatContext();
    const { chatId, sendNudge, state: chatState } = chatContext;
    const projectId = chatContext.chatType === 'phase' ? chatContext.projectId : undefined;
    const { addArtifact } = useArtifactActions();
    const { openPanel } = useActivePanelContext();

    const { trigger: restoreVersion, isMutating: isRestoring } = useRestoreProjectArtifactVersion(
        projectId,
        artifactKey,
    );

    // Cross-phase redirect state (project-only — intake always nudges directly).
    const [redirect, setRedirect] = useState<RedirectState>(REDIRECT_IDLE);

    const restore = useCallback(
        async (opts: { sourceVersionId: string; sourceVersionNumber: number }) => {
            try {
                const updatedArtifact = await restoreVersion({ sourceVersionId: opts.sourceVersionId });
                const restoredVersion = updatedArtifact.version;

                addArtifact(
                    {
                        ...updatedArtifact,
                        id: artifactKey,
                        isLoading: false,
                        isStreaming: false,
                        isUpdating: false,
                    },
                    restoredVersion,
                );
                openPanel({ panel: 'artifact-preview', artifactId: artifactKey, version: restoredVersion });

                toast({ title: `Restored v${opts.sourceVersionNumber} as v${restoredVersion}` });

                const targetChatId = updatedArtifact.chatId;
                if (targetChatId && targetChatId !== chatId) {
                    setRedirect({ open: true, chatId: targetChatId, pendingNavigation: false });
                } else {
                    await sendNudge();
                }
            } catch (error) {
                console.error('Failed to restore artifact version:', error);
                toast({
                    title: error instanceof Error ? error.message : 'Failed to restore version',
                    variant: 'destructive',
                });
                throw error;
            }
        },
        [restoreVersion, addArtifact, artifactKey, openPanel, chatId, sendNudge],
    );

    const confirmRedirect = useCallback(() => {
        setRedirect((prev) => ({ ...prev, open: false, pendingNavigation: true }));
    }, []);

    useEffect(() => {
        if (!redirect.pendingNavigation || redirect.open || !redirect.chatId) return;
        setRedirect(REDIRECT_IDLE);
        router.push(`/${projectId}/${redirect.chatId}?${SEARCH_PARAMS.NUDGE}=true`);
    }, [redirect, router, projectId]);

    return {
        restore,
        isRestoring,
        isGenerating: chatState.isGenerating,
        redirectDialog: {
            open: redirect.open,
            onConfirm: confirmRedirect,
        },
    };
}
