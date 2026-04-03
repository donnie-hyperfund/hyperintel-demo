import { Check, Pen } from 'lucide-react';
import Link from 'next/link';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsTruncated } from '@/hooks/use-is-truncated';
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
    const { ref: nameRef, isTruncated, onMouseEnter } = useIsTruncated();
    const displayName = chat.name ?? 'Unnamed phase';

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
                <Tooltip open={isTruncated ? undefined : false} delayDuration={750}>
                    <TooltipTrigger asChild>
                        <span
                            ref={nameRef}
                            onMouseEnter={onMouseEnter}
                            className={cn('truncate block mb-1', !chat.name && 'text-neutral-500')}
                        >
                            {displayName}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{displayName}</TooltipContent>
                </Tooltip>
                <span className="text-xs text-neutral-500 truncate block">Phase {chat.phaseIndex + 1}</span>
            </div>
            <Tooltip>
                <TooltipTrigger asChild>
                    <IconButton
                        size="sm"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onEdit(chat.id);
                        }}
                        className="shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
                    >
                        <Pen />
                    </IconButton>
                </TooltipTrigger>
                <TooltipContent>Rename phase</TooltipContent>
            </Tooltip>
            {isActive && <Check className="size-3.5 text-primary shrink-0" />}
        </Link>
    );
};
