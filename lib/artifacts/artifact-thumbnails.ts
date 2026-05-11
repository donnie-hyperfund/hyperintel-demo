import sharp from 'sharp';

export const THUMBNAIL_SIZES = { sm: 80 } as const;
export type ThumbnailSize = keyof typeof THUMBNAIL_SIZES;

const THUMBNAIL_QUALITY = 80;

/**
 * Derive the R2 storage key for a thumbnail from the original file's storage key.
 * The size label is encoded in the key so multiple sizes can coexist.
 *
 * Example: `uploads/project/abc/ver123/uuid.png` → `uploads/project/abc/ver123/thumbnails/uuid-sm.webp`
 */
export function deriveThumbnailKey(storageKey: string, size: ThumbnailSize = 'sm'): string {
    const lastSlash = storageKey.lastIndexOf('/');
    const dir = lastSlash > 0 ? storageKey.slice(0, lastSlash) : '';
    const filename = lastSlash > 0 ? storageKey.slice(lastSlash + 1) : storageKey;
    const dotIdx = filename.lastIndexOf('.');
    const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
    return `${dir}/thumbnails/${base}-${size}.webp`;
}

/**
 * Generate a cover-fit WebP thumbnail from raw image bytes.
 * Must be called from Node.js (Next.js API routes), not CF Workers.
 */
export async function generateThumbnail(imageBytes: Buffer, size: ThumbnailSize = 'sm'): Promise<Buffer> {
    const px = THUMBNAIL_SIZES[size];
    return sharp(imageBytes).resize(px, px, { fit: 'cover' }).webp({ quality: THUMBNAIL_QUALITY }).toBuffer();
}
