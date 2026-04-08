'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

function ImageLightbox({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="image-lightbox" {...props} />;
}

function ImageLightboxTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="image-lightbox-trigger" {...props} />;
}

function ImageLightboxContent({
    src,
    alt,
    className,
    ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, 'children'> & {
    src: string;
    alt?: string;
}) {
    return (
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
                data-slot="image-lightbox-overlay"
                className={cn(
                    'fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-8 py-16 backdrop-blur-sm',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                )}
            >
                <DialogPrimitive.Content
                    data-slot="image-lightbox-content"
                    className={cn(
                        'relative',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                        className,
                    )}
                    {...props}
                >
                    <DialogPrimitive.Title className="sr-only">{alt || 'Image preview'}</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        Full-size image preview
                    </DialogPrimitive.Description>

                    <img
                        src={src}
                        alt={alt}
                        className="max-h-[calc(100vh-8rem)] max-w-[calc(100vw-4rem)] object-contain rounded-3"
                    />
                </DialogPrimitive.Content>

                <DialogPrimitive.Close data-slot="image-lightbox-close" asChild>
                    <IconButton
                        className="absolute top-4 right-4 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white"
                        size="lg"
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </IconButton>
                </DialogPrimitive.Close>
            </DialogPrimitive.Overlay>
        </DialogPrimitive.Portal>
    );
}

export { ImageLightbox, ImageLightboxTrigger, ImageLightboxContent };
