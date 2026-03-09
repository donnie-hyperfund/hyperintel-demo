'use client';

import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ChatPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

type StakeholderChatInterfaceProps = {
    title: string;
};

export function StakeholderChatInterface({ title }: StakeholderChatInterfaceProps) {
    const { panelState, closePanel } = useActivePanelContext();

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <ChatPanel
                    HeaderComponent={
                        <DashboardHeader title={title} parent={{ label: 'Stakeholders', href: '/stakeholders' }} />
                    }
                    emptyTitle="Let’s build a new stakeholder persona."
                    emptySubtitle="Tell us about the stakeholder or upload supporting documents. We’ll take it from there."
                />
            }
            RightPaneComponent={
                panelState?.panel === 'artifact-preview' && (
                    <ArtifactPreviewPanel
                        version={panelState.version}
                        artifactId={panelState.artifactId}
                        onClose={closePanel}
                    />
                )
            }
        />
    );
}
