'use client';

import { X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useChatContext } from '@/modules/chat/providers/chat-provider';
import { FileDropOverlay } from '@/modules/file-uploads/components/file-drop-overlay';
import { FileUploadProvider } from '@/modules/file-uploads/providers/file-upload-provider';
import { LinkResourceDialog } from './link-resource-dialog';
import { ResourceList } from './resource-list';
import { UploadResource } from './upload-resource';

type ResourcesPanelParams = PageParams<'/[project-id]'>;

interface ResourcesPanelProps {
    onClose: () => void;
}

export default function ResourcesPanel({ onClose }: ResourcesPanelProps) {
    const { 'project-id': projectId } = useParams<ResourcesPanelParams>();
    const { chatId } = useChatContext();

    return (
        <FileUploadProvider scope={{ projectId, chatId: chatId ?? undefined }}>
            <FileDropOverlay className="flex flex-col h-full bg-neutral-975 animate-in fade-in duration-300">
                <div className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
                    <h2 className="text-sm font-medium">Project Intel</h2>
                    <div className="flex items-center gap-1">
                        <UploadResource />
                        <LinkResourceDialog />
                        <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
                            <X className="size-4" />
                        </Button>
                    </div>
                </div>
                <div className="flex flex-1 flex-col overflow-y-auto p-4">
                    <ResourceList />
                </div>
            </FileDropOverlay>
        </FileUploadProvider>
    );
}
