'use client';

import { useArtifactContext } from '@/app/modules/chat/providers/artifact-provider';
import { ChatModule } from '@/app/modules/chat/providers/chat-module';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import ArtifactsPanel from './_components/artifacts-panel';
import ChatPanel from './_components/chat-panel';

const ChatPageContent = () => {
    const { isVisible: isArtifactsPanelVisible } = useArtifactContext();

    return (
        <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Chat Panel */}
            <ResizablePanel
                id="chat-panel"
                order={1}
                defaultSize={60}
                minSize={40}
                maxSize={80}
                className={cn(isArtifactsPanelVisible && 'shadow-[inset_-4px_0_48px_rgba(0,0,0,0.25)]')}
            >
                <ChatPanel />
            </ResizablePanel>

            {isArtifactsPanelVisible && (
                <>
                    <ResizableHandle />

                    {/* Artifacts Panel */}
                    <ResizablePanel id="artifacts-panel" order={2} defaultSize={40} minSize={20}>
                        <ArtifactsPanel />
                    </ResizablePanel>
                </>
            )}
        </ResizablePanelGroup>
    );
};

export default function Page() {
    return (
        <ChatModule>
            <ChatPageContent />
        </ChatModule>
    );
}
