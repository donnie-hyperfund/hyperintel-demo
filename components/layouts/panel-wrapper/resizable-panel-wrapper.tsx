'use client';

import { Fragment, type ReactNode, useEffect } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { isAboveBreakpoint, useBreakpoint } from '@/hooks/use-breakpoint';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';

type ResizablePanelWrapperProps = {
    LeftPaneComponent: ReactNode;
    RightPaneComponent: ReactNode;
    rightPaneDefaultSize?: number;
    rightPaneMaxSize?: number;
};

export const ResizablePanelWrapper = ({
    LeftPaneComponent,
    RightPaneComponent,
    rightPaneDefaultSize = 35,
    rightPaneMaxSize = 40,
}: ResizablePanelWrapperProps) => {
    const { panelState } = useActivePanelContext();
    const { breakpoint } = useBreakpoint();

    const isMdViewportOrSmaller = !isAboveBreakpoint(breakpoint, 'md');

    const isPanelOpen = panelState !== null;
    const activePanel = panelState?.panel;

    useEffect(() => {
        if (!isMdViewportOrSmaller) return;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, [isMdViewportOrSmaller]);

    if (isMdViewportOrSmaller) {
        return (
            <div className="fixed inset-0 top-(--processing-bar-height,0px) flex min-h-0 flex-col">
                {LeftPaneComponent}
                {isPanelOpen && (
                    <div className="fixed inset-0 top-(--processing-bar-height,0px) z-50 bg-neutral-975 animate-in fade-in slide-in-from-bottom-4 duration-200">
                        {RightPaneComponent}
                    </div>
                )}
            </div>
        );
    }

    return (
        <>
            {/* Chat routes own their viewport budget here so the dashboard root can stay document-height for list pages. */}
            <div className="min-h-0" style={{ height: 'calc(100dvh - var(--processing-bar-height, 0px))' }}>
                <ResizablePanelGroup id="chat-interface-panels" direction="horizontal" className="h-full min-h-0">
                    <ResizablePanel
                        id="chat-panel"
                        order={1}
                        defaultSize={60}
                        minSize={100 - rightPaneMaxSize}
                        maxSize={80}
                        className={cn(isPanelOpen && 'shadow-[inset_-4px_0_48px_rgba(0,0,0,0.25)]', 'h-full min-h-0')}
                    >
                        {LeftPaneComponent}
                    </ResizablePanel>

                    {isPanelOpen && (
                        <Fragment key={activePanel}>
                            <ResizableHandle />

                            <ResizablePanel
                                id="right-panel"
                                order={2}
                                defaultSize={rightPaneDefaultSize}
                                minSize={20}
                                maxSize={rightPaneMaxSize}
                                className="flex h-full min-h-0 flex-col"
                            >
                                {RightPaneComponent}
                            </ResizablePanel>
                        </Fragment>
                    )}
                </ResizablePanelGroup>
            </div>
        </>
    );
};
