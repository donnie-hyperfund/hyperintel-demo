'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import { FilePreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/file-preview-panel';
import ProjectArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/project-artifacts-panel';
import ResourcesPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/resources-panel';
import { PhaseHeader } from '@/components/layouts/dashboard-layout/phase-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { usePanelIntentParam } from '@/hooks/use-panel-intent-param';
import { useArtifactProcessing } from '@/modules/artifacts/processing/artifact-processing-provider';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { useScrollTargetContext } from '@/modules/chat/providers/scroll-target-provider';
import ChatPanel from './chat-panel';

export default function PhaseChatInterface() {
    const { panelState, closePanel } = useActivePanelContext();
    const { chatId, projectId } = useChatContext();
    const { activeEntries, checkProjectEntry } = useArtifactProcessing();
    const { scrollTo } = useScrollTargetContext();
    const router = useRouter();

    usePanelIntentParam();

    // On mount: if there's a processing artifact for this chat, scroll to it
    // and open its preview. If the user just entered this project (not switching
    // phases) and the processing artifact is in a different chat, navigate there.
    const mountStateRef = useRef({ panelState, activeEntries, chatId, projectId });
    useEffect(() => {
        const {
            panelState: initialPanelState,
            activeEntries: initialEntries,
            chatId: initialChatId,
            projectId: initialProjectId,
        } = mountStateRef.current;

        if (initialPanelState?.panel === 'artifact-preview') return;

        const currentChatEntry = initialEntries.find((entry) => entry.chatId === initialChatId);
        if (currentChatEntry) {
            const version =
                currentChatEntry.action === 'restore'
                    ? currentChatEntry.sourceVersionNumber
                    : currentChatEntry.artifactVersion;
            scrollTo({ key: currentChatEntry.artifactName, version });
            return;
        }

        if (!initialProjectId || !checkProjectEntry(initialProjectId)) return;

        const otherChatEntry = initialEntries.find(
            (entry) => entry.projectId === initialProjectId && entry.chatId && entry.chatId !== initialChatId,
        );
        if (otherChatEntry?.chatId) {
            router.push(`/${initialProjectId}/${otherChatEntry.chatId}`);
        }
    }, [scrollTo, router, checkProjectEntry]);

    const activePanel = panelState?.panel;
    const isActivePanelWide = activePanel === 'artifact-preview' || activePanel === 'file-preview';

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <ChatPanel
                    HeaderComponent={<PhaseHeader />}
                    emptyTitle="What would you like your team to work on?"
                    emptySubtitle="Describe your objective and your Superhuman team will get to work."
                />
            }
            RightPaneComponent={
                <>
                    {panelState?.panel === 'artifact-preview' && (
                        <ArtifactPreviewPanel
                            onClose={closePanel}
                            version={panelState.version}
                            artifactId={panelState.artifactId}
                        />
                    )}
                    {panelState?.panel === 'file-preview' && (
                        <FilePreviewPanel
                            onClose={closePanel}
                            artifactId={panelState.artifactId}
                            version={panelState.version}
                        />
                    )}
                    {activePanel === 'artifacts' && <ProjectArtifactsPanel onClose={closePanel} />}
                    {activePanel === 'resources' && <ResourcesPanel onClose={closePanel} />}
                </>
            }
            rightPaneDefaultSize={isActivePanelWide ? 35 : 25}
            rightPaneMaxSize={isActivePanelWide ? 80 : 30}
        />
    );
}
