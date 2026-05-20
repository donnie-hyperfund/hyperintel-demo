'use client';

import { ArtifactFilePreview } from './artifact-file-preview/artifact-file-preview';
import { UrlFilePreview } from './url-file-preview/url-file-preview';

type FilePreviewPanelProps = {
    onClose: () => void;
} & ({ artifactId: string } | { fileUrl: string; fileName: string; mimeType: string });

export function FilePreviewPanel(props: FilePreviewPanelProps) {
    if ('fileUrl' in props) {
        return (
            <UrlFilePreview
                fileUrl={props.fileUrl}
                fileName={props.fileName}
                mimeType={props.mimeType}
                onClose={props.onClose}
            />
        );
    }

    return <ArtifactFilePreview artifactId={props.artifactId} onClose={props.onClose} />;
}
