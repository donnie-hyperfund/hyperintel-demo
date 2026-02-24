'use client';

import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ChatPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

export default function NewCompanyPage() {
    const { panelState, closePanel } = useActivePanelContext();

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <ChatPanel
                    HeaderComponent={
                        <DashboardHeader title="New company" parent={{
                            label: 'Companies',
                            href: '/companies',
                        }} />
                    }
                    emptyTitle="Ready to build organizational intelligence?"
                    emptySubtitle="Tell us about the company and we'll create a comprehensive profile."
                />
            }
            RightPaneComponent={
                panelState?.panel === 'artifact-preview' ? (
                    <ArtifactPreviewPanel
                        version={panelState.version}
                        artifactId={panelState.artifactId}
                        onClose={closePanel}
                    />
                ) : undefined
            }
        />
    );
}
