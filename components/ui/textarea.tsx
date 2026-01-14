import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const textareaVariants = cva(
    'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-red-500/20 aria-invalid:border-red-500/60 dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
    {
        variants: {
            size: {
                sm: 'px-3 py-2 text-sm',
                default: 'px-3 py-2 text-base md:text-sm',
                lg: 'px-4 py-3 text-base md:text-sm',
                xl: 'px-4 py-3 text-base md:text-sm',
            },
        },
        defaultVariants: {
            size: 'default',
        },
    },
);

export type TextareaProps = Omit<React.ComponentProps<'textarea'>, 'size'> & VariantProps<typeof textareaVariants>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, size = 'default', ...props }, ref) => {
        return (
            <textarea ref={ref} data-slot="textarea" className={cn(textareaVariants({ size, className }))} {...props} />
        );
    },
);
Textarea.displayName = 'Textarea';

export { Textarea };
