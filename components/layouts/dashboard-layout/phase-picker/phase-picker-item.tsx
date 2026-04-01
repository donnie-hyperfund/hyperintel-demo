import { Check, Pen } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { CamelCaseDto } from '@/lib/api/client/types';
import type { ChatDto } from '@/lib/schema/message';
import { cn } from '@/lib/utils';

type PhasePickerItemProps = {
    chat: CamelCaseDto<ChatDto>;
    projectId?: string;
    isActive: boolean;
    onSelect: () => void;
    onEdit: (chatId: string) => void;
};

export const PhasePickerItem = ({ chat, projectId, isActive, onSelect, onEdit }: PhasePickerItemProps) => {
    return (
        <Link
            href={`/${projectId}/${chat.id}`}
            onClick={onSelect}
            className={cn(
                'group/item flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent',
                isActive && 'bg-accent/50',
            )}
        >
            <div className="flex-1 min-w-0">
                <span className={cn('truncate block mb-1', !chat.name && 'text-neutral-500')}>
                    {chat.name ?? 'Unnamed phase'}
                </span>
                <span className="text-xs text-neutral-500 truncate block">Phase {chat.phaseIndex + 1}</span>
            </div>
            <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEdit(chat.id);
                }}
                className="shrink-0 size-7 opacity-0 group-hover/item:opacity-100 transition-opacity"
            >
                <Pen className="size-3.5 text-muted-foreground" />
            </Button>
            {isActive && <Check className="size-3.5 text-primary shrink-0" />}
        </Link>
    );
};
