'use client';

import { Lightbox, LightboxContent, LightboxTrigger } from '@/components/ui/lightbox';

function ImageLightbox({ ...props }: React.ComponentProps<typeof Lightbox>) {
    return <Lightbox {...props} />;
}

function ImageLightboxTrigger({ ...props }: React.ComponentProps<typeof LightboxTrigger>) {
    return <LightboxTrigger {...props} />;
}

function ImageLightboxContent({ src, alt, className }: { src: string; alt?: string; className?: string }) {
    return (
        <LightboxContent title={alt || 'Image preview'} description="Full-size image preview" className={className}>
            <img
                src={src}
                alt={alt}
                className="max-h-[calc(100vh-8rem)] max-w-[calc(100vw-4rem)] object-contain rounded-3"
            />
        </LightboxContent>
    );
}

export { ImageLightbox, ImageLightboxTrigger, ImageLightboxContent };
