'use client';

import { Building2, Layers } from 'lucide-react';
import { useParams } from 'next/navigation';
import { PhasePicker } from '@/components/layouts/dashboard-layout/phase-picker';
import { Button } from '@/components/ui/button';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { getPhaseNumber, sortChatsByCreatedAt } from '@/lib/phases';
import { cn } from '@/lib/utils';
import { useActivePanelContext } from '@/modules/chat/providers/active-panel-provider';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export function DashboardHeader() {
    const params = useParams();
    const projectId = params?.['project-id'] as string | undefined;
    const { chatId: contextChatId } = useChatContext();
    const chatId = (params?.chatId as string | undefined) ?? contextChatId ?? undefined;
    const { panelState, togglePanel } = useActivePanelContext();

    const { data: project } = useFetchProject(projectId);
    const { data: chatsData } = useFetchChats(projectId, { limit: 100 });

    const chats = sortChatsByCreatedAt(chatsData?.data ?? []);
    const phaseNumber = chatId && chatsData?.data ? getPhaseNumber(chatsData.data, chatId) : null;
    const phaseName = phaseNumber ? `Phase ${phaseNumber}` : null;

    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <div className="flex items-center gap-3">
                {project?.name && <span className="text-sm text-muted-foreground">{project.name}</span>}
                {project?.name && <span className="text-sm text-neutral-600">/</span>}

                <PhasePicker projectId={projectId} chats={chats} currentChatId={chatId} phaseName={phaseName} />
            </div>
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
}
