'use client';

import { Building, FilePlus2, Users } from 'lucide-react';
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
    onNavigate: (path: string) => void;
};

export function NewResourceDropdown({ projectId, onNavigate }: NewResourceDropdownProps) {
    const { chatId } = useChatContext();

    const handleSelect = useCallback(
        (resourceType: 'company' | 'stakeholder') => {
            const query = buildProjectOriginQuery({
                origin: 'project',
                projectId,
                ...(chatId && { sourceChatId: chatId }),
            });

            const path = `/${resourceType === 'company' ? 'companies' : 'stakeholders'}/new?${query}`;
            onNavigate(path);
        },
        [chatId, onNavigate, projectId],
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
                <DropdownMenuItem onSelect={() => handleSelect('company')}>
                    <Building className="size-4" />
                    New company
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSelect('stakeholder')}>
                    <Users className="size-4" />
                    New stakeholder
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
