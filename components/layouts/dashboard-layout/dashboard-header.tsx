'use client';

import { Layers } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import { useFetchProject } from '@/lib/api/client/hooks/use-projects';
import { getPhaseNumber } from '@/lib/phases';

export function DashboardHeader() {
    const params = useParams();
    const projectId = params?.['project-id'] as string | undefined;
    const chatId = params?.chatId as string | undefined;

    const { data: project } = useFetchProject(projectId);
    const { data: chatsData } = useFetchChats(projectId, { limit: 100 });

    const phaseNumber = chatId && chatsData?.data ? getPhaseNumber(chatsData.data, chatId) : null;

    const breadcrumb = [project?.name, phaseNumber ? `Phase ${phaseNumber}` : null].filter(Boolean).join(' / ');

    const artifactsHref = projectId ? `/${projectId}/artifacts` : '#';

    return (
        <header className="h-14 border-b border-border flex items-center px-6 gap-4">
            <div className="flex items-center gap-2">
                {breadcrumb && <div className="text-sm text-muted-foreground">{breadcrumb}</div>}
            </div>
            <div className="ml-auto">
                <Button variant="ghost" size="icon" asChild>
                    <Link href={artifactsHref}>
                        <Layers className="size-4" />
                    </Link>
                </Button>
            </div>
        </header>
    );
}
