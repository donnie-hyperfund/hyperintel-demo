'use client';

import { Building2, Layers } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PhasePicker } from '@/components/layouts/dashboard-layout/phase-picker';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { IconButton } from '@/components/ui/icon-button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export const PhaseHeader = () => {
    const { 'project-id': projectId } = useParams<PageParams<'/[project-id]'>>();

    const { chatId, state } = useChatContext();
    const { data: project } = useFetchProject(projectId);
    const { panelState, togglePanel } = useActivePanelContext();

    return (
        <header className="border-b border-border max-sm:sticky max-sm:top-(--processing-bar-height,0px) max-sm:left-0 max-sm:right-0 max-sm:z-10 bg-neutral-975">
            {/* Desktop */}
            <div className="hidden md:flex h-14 items-center px-6 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <PhaseBreadcrumbs
                        projectId={projectId}
                        projectName={project?.name}
                        chatId={chatId ?? undefined}
                        phaseIndex={state.phaseIndex}
                    />
                </div>
                <div className="ml-auto">
                    <PanelButtons panelState={panelState} togglePanel={togglePanel} />
                </div>
            </div>
            {/* Mobile */}
            <div className="md:hidden">
                <div className="flex h-12 items-center px-4 gap-3">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <SidebarTrigger className="size-8 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent>Toggle sidebar</TooltipContent>
                    </Tooltip>
                    <div className="ml-auto flex items-center gap-2">
                        <PanelButtons panelState={panelState} togglePanel={togglePanel} />
                    </div>
                </div>
                <div className="px-4 pb-2 min-w-0">
                    <PhaseBreadcrumbs
                        projectId={projectId}
                        projectName={project?.name}
                        chatId={chatId ?? undefined}
                        phaseIndex={state.phaseIndex}
                    />
                </div>
            </div>
        </header>
    );
};

type PanelButtonsProps = {
    panelState: ReturnType<typeof useActivePanelContext>['panelState'];
    togglePanel: ReturnType<typeof useActivePanelContext>['togglePanel'];
};

function PanelButtons({ panelState, togglePanel }: PanelButtonsProps) {
    return (
        <div className="flex items-center gap-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <IconButton
                        data-active={panelState?.panel === 'artifacts' || undefined}
                        onClick={() => togglePanel({ panel: 'artifacts' })}
                    >
                        <Layers />
                    </IconButton>
                </TooltipTrigger>
                <TooltipContent>Artifacts</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <IconButton
                        data-active={panelState?.panel === 'resources' || undefined}
                        onClick={() => togglePanel({ panel: 'resources' })}
                    >
                        <Building2 />
                    </IconButton>
                </TooltipTrigger>
                <TooltipContent>Project Intel</TooltipContent>
            </Tooltip>
        </div>
    );
}

type PhaseBreadcrumbsProps = {
    projectId: string;
    projectName?: string;
    chatId?: string;
    phaseIndex?: number | null;
};

function PhaseBreadcrumbs({ projectId, projectName, chatId, phaseIndex }: PhaseBreadcrumbsProps) {
    return (
        <Breadcrumb className="min-w-0 overflow-hidden">
            <BreadcrumbList className="min-w-0 flex-nowrap">
                {projectName && (
                    <>
                        <BreadcrumbItem className="min-w-0 shrink">
                            <BreadcrumbLink asChild>
                                <Link href={`/${projectId}/chats`} className="truncate">
                                    {projectName}
                                </Link>
                            </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="shrink-0" />
                    </>
                )}
                <BreadcrumbItem className="min-w-0 shrink">
                    <PhasePicker projectId={projectId} currentChatId={chatId} currentPhaseIndex={phaseIndex} />
                </BreadcrumbItem>
            </BreadcrumbList>
        </Breadcrumb>
    );
}
