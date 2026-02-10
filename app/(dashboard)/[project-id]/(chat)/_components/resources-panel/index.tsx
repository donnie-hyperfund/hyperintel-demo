'use client';

import { Building2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ResourcesPanelProps {
    onClose: () => void;
}

export default function ResourcesPanel({ onClose }: ResourcesPanelProps) {
    return (
        <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <h2 className="text-sm font-medium">Resources</h2>
                <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
                    <X className="size-4" />
                </Button>
            </div>
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center space-y-2">
                    <Building2 className="size-12 mx-auto opacity-50" />
                    <p className="text-sm">Companies &amp; Stakeholders coming soon</p>
                </div>
            </div>
        </div>
    );
}
