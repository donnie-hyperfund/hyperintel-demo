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
import { Button } from '@/components/ui/button';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export const PhaseHeader = () => {
    const { 'project-id': projectId } = useParams<PageParams<'/[project-id]'>>();

    const { chatId, state } = useChatContext();
    const { data: project } = useFetchProject(projectId);
    const { panelState, togglePanel } = useActivePanelContext();

    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <Breadcrumb>
                <BreadcrumbList>
                    {project?.name && (
                        <>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link href={`/${projectId}/chats`}>{project.name}</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                        </>
                    )}
                    <BreadcrumbItem>
                        <PhasePicker
                            projectId={projectId}
                            currentChatId={chatId ?? undefined}
                            currentPhaseIndex={state.phaseIndex}
                        />
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => togglePanel({ panel: 'artifacts' })}
                    className={cn(
                        'text-neutral-400',
                        panelState?.panel === 'artifacts' && 'bg-accent text-neutral-100',
                    )}
                >
                    <Layers className="size-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => togglePanel({ panel: 'resources' })}
                    className={cn(
                        'text-neutral-400',
                        panelState?.panel === 'resources' && 'bg-accent text-neutral-100',
                    )}
                >
                    <Building2 className="size-4" />
                </Button>
            </div>
        </header>
    );
};
