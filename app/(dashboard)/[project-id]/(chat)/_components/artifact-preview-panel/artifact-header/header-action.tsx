import type { LucideIcon } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type ActionType = 'button' | 'menu-item';

type HeaderActionProps = {
    type: ActionType;
    icon: LucideIcon;
    iconClassName?: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
};

export function HeaderAction({
    type,
    icon: Icon,
    iconClassName = 'size-4',
    label,
    onClick,
    disabled,
}: HeaderActionProps) {
    if (type === 'menu-item') {
        return (
            <DropdownMenuItem
                onSelect={(e) => {
                    e.preventDefault();
                    onClick();
                }}
                disabled={disabled}
            >
                <Icon className={iconClassName} />
                {label}
            </DropdownMenuItem>
        );
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <IconButton size="sm" onClick={onClick} disabled={disabled}>
                    <Icon className={iconClassName} />
                </IconButton>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
