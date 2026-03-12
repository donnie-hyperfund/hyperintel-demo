'use client';

import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ProjectArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/project-artifacts-panel';
import ResourcesPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/resources-panel';
import { PhaseHeader } from '@/components/layouts/dashboard-layout/phase-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import ChatPanel from './chat-panel';

export default function PhaseChatInterface() {
    const { panelState, closePanel } = useActivePanelContext();

    const activePanel = panelState?.panel;

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
                    {activePanel === 'artifacts' && <ProjectArtifactsPanel onClose={closePanel} />}
                    {activePanel === 'resources' && <ResourcesPanel onClose={closePanel} />}
                </>
            }
            rightPaneDefaultSize={activePanel === 'artifact-preview' ? 35 : 20}
        />
    );
}
