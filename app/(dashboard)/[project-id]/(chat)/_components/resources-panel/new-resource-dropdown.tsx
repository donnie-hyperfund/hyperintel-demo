'use client';

import { Building, FilePlus2, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildProjectOriginQuery } from '@/lib/intake/project-origin';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

type NewResourceDropdownProps = {
    projectId: string;
    onNavigate: () => void;
};

export function NewResourceDropdown({ projectId, onNavigate }: NewResourceDropdownProps) {
    const router = useRouter();
    const { chatId } = useChatContext();

    const handleNavigate = useCallback(
        (resourceType: 'company' | 'stakeholder') => {
            const query = buildProjectOriginQuery({
                origin: 'project',
                projectId,
                ...(chatId && { sourceChatId: chatId }),
            });

            onNavigate();
            router.push(`/${resourceType === 'company' ? 'companies' : 'stakeholders'}/new?${query}`);
        },
        [chatId, onNavigate, projectId, router],
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="soft">
                    New resource
                    <FilePlus2 className="size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => handleNavigate('company')}>
                    <Building className="size-4" />
                    New company
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleNavigate('stakeholder')}>
                    <Users className="size-4" />
                    New stakeholder
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
