'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LinkResourceDialog } from './link-resource-dialog';
import { ResourceList } from './resource-list';

interface ResourcesPanelProps {
    onClose: () => void;
}

export default function ResourcesPanel({ onClose }: ResourcesPanelProps) {
    return (
        <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <h2 className="text-sm font-medium">Resources</h2>
                <div className="flex items-center gap-1">
                    <LinkResourceDialog />
                    <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
                        <X className="size-4" />
                    </Button>
                </div>
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto p-4">
                <ResourceList />
            </div>
        </div>
    );
}
