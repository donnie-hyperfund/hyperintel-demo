'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

function Lightbox({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="lightbox" {...props} />;
}

function LightboxTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="lightbox-trigger" {...props} />;
}

function LightboxOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
    return (
        <DialogPrimitive.Overlay
            data-slot="lightbox-overlay"
            className={cn(
                'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                className,
            )}
            {...props}
        />
    );
}

function LightboxContent({
    className,
    children,
    title,
    description,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    title?: string;
    description?: string;
}) {
    return (
        <DialogPrimitive.Portal>
            <LightboxOverlay className="flex items-center justify-center">
                <DialogPrimitive.Content
                    data-slot="lightbox-content"
                    className={cn(
                        'relative',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                        className,
                    )}
                    {...props}
                >
                    <DialogPrimitive.Title className="sr-only">{title || 'Preview'}</DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        {description || 'Full-screen preview'}
                    </DialogPrimitive.Description>
                    {children}
                </DialogPrimitive.Content>

                <LightboxClose />
            </LightboxOverlay>
        </DialogPrimitive.Portal>
    );
}

function LightboxClose({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
    return (
        <DialogPrimitive.Close data-slot="lightbox-close" asChild {...props}>
            <IconButton
                className={cn(
                    'absolute top-4 right-4 z-10 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white',
                    className,
                )}
                size="lg"
            >
                <XIcon />
                <span className="sr-only">Close</span>
            </IconButton>
        </DialogPrimitive.Close>
    );
}

export { Lightbox, LightboxTrigger, LightboxOverlay, LightboxContent, LightboxClose };
