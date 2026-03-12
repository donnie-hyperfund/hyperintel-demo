'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { ArtifactPreviewPanel } from '@/app/(dashboard)/[project-id]/(chat)/_components/artifact-preview-panel';
import ChatPanel from '@/app/(dashboard)/[project-id]/(chat)/_components/chat-panel';
import { DashboardHeader } from '@/components/layouts/dashboard-layout/dashboard-header';
import { ResizablePanelWrapper } from '@/components/layouts/panel-wrapper/resizable-panel-wrapper';
import { Button } from '@/components/ui/button';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { FileDropProvider } from '@/modules/chat/providers/file-drop-provider';
import { useOptionalProjectOrigin } from '@/modules/intake/providers/project-origin-provider';

type IntakeChatInterfaceProps = {
    title: string;
    defaultParent: {
        label: string;
        href: string;
    };
    emptyTitle: string;
    emptySubtitle: string;
};

function ProjectOriginNotice({ text }: { text: string }) {
    return (
        <div className="border-b border-border bg-neutral-950/60 px-6 py-2.5 text-xs text-muted-foreground">{text}</div>
    );
}

export function IntakeChatInterface({ title, defaultParent, emptyTitle, emptySubtitle }: IntakeChatInterfaceProps) {
    const { panelState, closePanel } = useActivePanelContext();
    const { chatId } = useChatContext();
    const { parent: originParent, backHref, infoText } = useOptionalProjectOrigin();

    const parent = originParent ?? defaultParent;
    const actionComponent = backHref ? (
        <Button asChild variant="ghost" size="sm">
            <Link href={backHref}>
                <ArrowLeft className="size-4" />
                Back to project
            </Link>
        </Button>
    ) : undefined;

    return (
        <ResizablePanelWrapper
            LeftPaneComponent={
                <FileDropProvider scope={{ chatId: chatId ?? undefined }}>
                    <ChatPanel
                        HeaderComponent={
                            <>
                                <DashboardHeader title={title} parent={parent} ActionComponent={actionComponent} />
                                {infoText && <ProjectOriginNotice text={infoText} />}
                            </>
                        }
                        emptyTitle={emptyTitle}
                        emptySubtitle={emptySubtitle}
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
