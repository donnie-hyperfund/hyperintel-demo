'use client';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import ChatPanel from './_components/chat-panel';

export default function Page() {
    const IS_PREVIEW_PANEL_OPEN = true;

    return (
        <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Chat Panel */}
            <ResizablePanel
                id="chat-panel"
                order={1}
                defaultSize={75}
                minSize={40}
                maxSize={80}
                className={cn(IS_PREVIEW_PANEL_OPEN && 'shadow-[inset_-4px_0_48px_rgba(0,0,0,0.25)]')}
            >
                <ChatPanel />
            </ResizablePanel>

            {IS_PREVIEW_PANEL_OPEN && (
                <>
                    <ResizableHandle />

                    {/* Preview Panel */}
                    <ResizablePanel id="preview-panel" order={2} defaultSize={25} minSize={20}>
                        <div className="flex flex-col h-full shadow-lg bg-neutral-975">
                            {/* TODO: Add preview panel content */}
                        </div>
                    </ResizablePanel>
                </>
            )}
        </ResizablePanelGroup>
    );
}
