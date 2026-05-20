export function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() ?? '';
}

const IMAGE_EXTENSION_MIME_MAP: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/vnd.microsoft.icon',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    avif: 'image/avif',
};

export function getImageMimeType(filename: string): string {
    return IMAGE_EXTENSION_MIME_MAP[getFileExtension(filename)] ?? 'application/octet-stream';
}
