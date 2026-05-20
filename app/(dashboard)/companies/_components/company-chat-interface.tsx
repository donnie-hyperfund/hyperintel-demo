'use client';

import { IntakeHeader } from '@/app/(dashboard)/_components/intake-header';
import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ChatPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function CompanyChatInterface() {
    const { panelState, popPanel } = useActivePanelContext();
    const { chatId } = useChatContext();
    const title = chatId ? 'Company chat' : 'New company';

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <ChatPanel
                    HeaderComponent={
                        <IntakeHeader title={title} defaultParent={{ label: 'Companies', href: '/companies' }} />
                    }
                    emptyTitle="Let’s build a new company profile."
                    emptySubtitle="Tell us about the company or upload supporting documents. We’ll take it from there."
                />
            }
            RightPaneComponent={
                panelState?.panel === 'artifact-preview' && (
                    <ArtifactPreviewPanel
                        version={panelState.version}
                        artifactId={panelState.artifactId}
                        artifactKey={panelState.artifactKey}
                        onClose={popPanel}
                    />
                )
            }
        />
    );
}
