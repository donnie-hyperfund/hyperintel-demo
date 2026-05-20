'use client';

import { memo, useState } from 'react';
import { FileTypeIcon } from '@/components/ui/file-type-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type ImageThumbnailProps = {
    fileId: string;
    size?: number;
    className?: string;
};

export const ImageThumbnail = memo(function ImageThumbnail({ fileId, size = 20, className }: ImageThumbnailProps) {
    const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');

    if (status === 'failed') {
        return <FileTypeIcon filename="image.png" size={size} className={cn('shrink-0', className)} />;
    }

    return (
        <span className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
            {status === 'loading' && <Skeleton className="absolute inset-0 rounded" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={`/api/artifacts/files/${fileId}/thumbnail`}
                alt=""
                width={size}
                height={size}
                className={cn('rounded object-cover', status === 'loading' && 'invisible')}
                style={{ width: size, height: size }}
                onLoad={() => setStatus('loaded')}
                onError={() => setStatus('failed')}
            />
        </span>
    );
});
