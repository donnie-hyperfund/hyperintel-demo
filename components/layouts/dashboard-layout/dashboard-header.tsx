'use client';

import { Building2, Layers } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { getPhaseNumber } from '@/lib/phases';
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

    const phaseNumber = chatId && chatsData?.data ? getPhaseNumber(chatsData.data, chatId) : null;
    const breadcrumb = [project?.name, phaseNumber ? `Phase ${phaseNumber}` : null].filter(Boolean).join(' / ');

    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <div className="flex items-center gap-2">
                {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
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
