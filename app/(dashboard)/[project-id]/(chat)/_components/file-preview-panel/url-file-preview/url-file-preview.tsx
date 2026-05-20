'use client';

import { FilePreview } from '@/modules/file-preview/components/file-preview';
import { UrlFilePreviewHeader } from './url-file-preview-header';

type UrlFilePreviewProps = {
    fileUrl: string;
    fileName: string;
    mimeType: string;
    onClose: () => void;
};

export function UrlFilePreview({ fileUrl, fileName, mimeType, onClose }: UrlFilePreviewProps) {
    return (
        <div className="flex flex-col h-full bg-neutral-975 overflow-hidden">
            <UrlFilePreviewHeader fileName={fileName} onClose={onClose} />
            <div className="relative flex-1 min-h-0">
                <div className="absolute inset-0">
                    <FilePreview src={fileUrl} mimeType={mimeType} fileName={fileName} viewportGap={24} />
                </div>
            </div>
        </div>
    );
}
