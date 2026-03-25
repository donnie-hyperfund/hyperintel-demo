'use client';

import { useParams } from 'next/navigation';
import { SidePanel } from '@/components/side-panel';
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
            <FileDropOverlay>
                <SidePanel
                    title="Project Intel"
                    onClose={onClose}
                    actions={
                        <>
                            <UploadResource />
                            <LinkResourceDialog />
                        </>
                    }
                >
                    <ResourceList />
                </SidePanel>
            </FileDropOverlay>
        </FileUploadProvider>
    );
}
