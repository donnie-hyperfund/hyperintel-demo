'use client';

import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ArtifactsPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/artifacts-panel';
import ChatPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

export default function NewCompanyPage() {
    const { panelState, closePanel } = useActivePanelContext();

    const activePanel = panelState?.panel;

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <ChatPanel
                    HeaderComponent={
                        <DashboardHeader title="New company" parentLabel="Companies" parentHref="/companies" />
                    }
                    emptyTitle="Ready to build organizational intelligence?"
                    emptySubtitle="Tell us about the company and we'll create a comprehensive profile."
                />
            }
            RightPaneComponent={
                <>
                    {panelState?.panel === 'artifact-preview' && (
                        <ArtifactPreviewPanel version={panelState.version} artifactId={panelState.artifactId} />
                    )}
                    {activePanel === 'artifacts' && <ArtifactsPanel onClose={closePanel} />}
                </>
            }
        />
    );
}
