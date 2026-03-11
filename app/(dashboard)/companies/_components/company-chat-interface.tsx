'use client';

import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ChatPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { FileDropProvider } from '@/modules/chat/providers/file-drop-provider';

type CompanyChatInterfaceProps = {
    title: string;
};

export function CompanyChatInterface({ title }: CompanyChatInterfaceProps) {
    const { panelState, closePanel } = useActivePanelContext();
    const { chatId } = useChatContext();

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <FileDropProvider scope={{ chatId: chatId ?? undefined }}>
                    <ChatPanel
                        HeaderComponent={
                            <DashboardHeader title={title} parent={{ label: 'Companies', href: '/companies' }} />
                        }
                        emptyTitle="Let’s build a new company profile."
                        emptySubtitle="Tell us about the company or upload supporting documents. We’ll take it from there."
                    />
                </FileDropProvider>
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
