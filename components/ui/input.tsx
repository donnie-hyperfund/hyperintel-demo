import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const inputVariants = cva(
    'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-neutral-900 border-input w-full min-w-0 rounded-md border shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-red-500/20 aria-invalid:border-red-500/60',
    {
        variants: {
            size: {
                sm: 'h-8 px-3 py-1 text-sm',
                default: 'h-9 px-3 py-1 text-base md:text-sm',
                lg: 'h-10 px-4 py-1 text-base md:text-sm',
                xl: 'h-12 px-4 py-1 text-base md:text-sm',
            },
        },
        defaultVariants: {
            size: 'default',
        },
    },
);

export type InputProps = Omit<React.ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, size = 'default', ...props }, ref) => {
    return (
        <input ref={ref} type={type} data-slot="input" className={cn(inputVariants({ size, className }))} {...props} />
    );
});
Input.displayName = 'Input';

export { Input };
