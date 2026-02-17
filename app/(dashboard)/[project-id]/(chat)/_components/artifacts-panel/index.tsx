'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArtifactList } from './artifact-list';
import { ArtifactUploadDocument } from './artifact-upload-document';

type ArtifactsPanelProps = {
    onClose: () => void;
};

export default function ArtifactsPanel({ onClose }: ArtifactsPanelProps) {
    return (
        <div className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
            <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                <h2 className="text-sm font-medium">Deliverables</h2>
                <div className="flex items-center gap-1">
                    <ArtifactUploadDocument />
                    <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
                        <X className="size-4" />
                    </Button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                <ArtifactList />
            </div>
        </div>
    );
}
