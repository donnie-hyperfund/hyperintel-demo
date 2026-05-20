import { Pen } from 'lucide-react';
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
    const displayName = chat.name ?? `Phase ${chat.phaseIndex + 1}`;

    return (
        <Link
            href={`/${projectId}/${chat.id}`}
            onClick={onSelect}
            className={cn(
                'group/item flex items-center gap-1.5 px-2 py-1.5 text-sm transition-colors hover:bg-accent',
                isActive && 'bg-accent/50',
            )}
        >
            <div className="flex-1 min-w-0">
                <Tooltip open={isTruncated ? undefined : false} delayDuration={750}>
                    <TooltipTrigger asChild>
                        <span
                            ref={nameRef}
                            onMouseEnter={onMouseEnter}
                            className={cn('truncate block', !isActive && 'text-neutral-500')}
                        >
                            {displayName}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>{displayName}</TooltipContent>
                </Tooltip>
            </div>
            <Tooltip>
                <TooltipTrigger asChild>
                    <IconButton
                        size="xs"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onEdit(chat.id);
                        }}
                        className="[&_svg]:size-3.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
                    >
                        <Pen />
                    </IconButton>
                </TooltipTrigger>
                <TooltipContent>Rename phase</TooltipContent>
            </Tooltip>
        </Link>
    );
};
