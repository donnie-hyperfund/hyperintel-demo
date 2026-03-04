'use client';

import { Fragment, type ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

type ResizablePanelWrapperProps = {
    LeftPaneComponent: ReactNode;
    RightPaneComponent: ReactNode;
    rightPaneDefaultSize?: number;
};

export const ResizablePanelWrapper = ({
    LeftPaneComponent,
    RightPaneComponent,
    rightPaneDefaultSize = 35,
}: ResizablePanelWrapperProps) => {
    const { panelState } = useActivePanelContext();

    const isPanelOpen = panelState !== null;
    const activePanel = panelState?.panel;

    return (
        <ResizablePanelGroup id="chat-interface-panels" direction="horizontal" className="h-full">
            <ResizablePanel
                id="chat-panel"
                order={1}
                defaultSize={60}
                minSize={60}
                maxSize={80}
                className={cn(isPanelOpen && 'shadow-[inset_-4px_0_48px_rgba(0,0,0,0.25)]')}
            >
                {LeftPaneComponent}
            </ResizablePanel>

            {isPanelOpen && (
                <Fragment key={activePanel}>
                    <ResizableHandle />

                    <ResizablePanel id="right-panel" order={2} defaultSize={rightPaneDefaultSize} minSize={20}>
                        {RightPaneComponent}
                    </ResizablePanel>
                </Fragment>
            )}
        </ResizablePanelGroup>
    );
};
