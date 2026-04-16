import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/icon-button';

type SidePanelProps = {
    title: string;
    onClose: () => void;
    actions?: ReactNode;
    children: ReactNode;
};

export function SidePanel({ title, onClose, actions, children }: SidePanelProps) {
    return (
        <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <h2 className="text-sm font-medium">{title}</h2>
                <div className="flex items-center gap-0.5">
                    {actions}
                    <IconButton size="sm" onClick={onClose}>
                        <X />
                    </IconButton>
                </div>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto p-4">{children}</div>
        </div>
    );
}
