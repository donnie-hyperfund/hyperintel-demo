import Image from 'next/image';
import { getFileExtension } from '@/lib/files';
import { cn } from '@/lib/utils';

const EXTENSION_ICONS: Record<string, string> = {
    md: '/icons/extensions/md.svg',
    pdf: '/icons/extensions/pdf.svg',
    docx: '/icons/extensions/docx.svg',
    xlsx: '/icons/extensions/xlsx.svg',
};

type FileTypeIconProps = {
    filename: string;
    size?: number;
    className?: string;
};

export function FileTypeIcon({ filename, size = 20, className }: FileTypeIconProps) {
    const ext = getFileExtension(filename);
    const src = EXTENSION_ICONS[ext];

    if (!src) {
        return <div className={cn(className, 'bg-neutral-600 rounded-4')} style={{ width: size, height: size }} />;
    }

    return (
        <Image
            src={src}
            alt={`.${ext} file`}
            width={size}
            height={size}
            className={className}
            style={{ borderRadius: 4 }}
        />
    );
}
