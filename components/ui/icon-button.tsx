import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const iconButtonVariants = cva(
    'inline-flex items-center justify-center rounded-md shrink-0 outline-none transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    {
        variants: {
            variant: {
                ghost: 'text-neutral-400 hover:bg-neutral-300/5 hover:text-neutral-100 data-[active]:bg-accent data-[active]:text-neutral-100',
                light: 'hover:bg-accent/50 text-neutral-400 hover:text-neutral-100',
            },
            size: {
                lg: 'size-10 [&_svg]:size-5',
                default: 'size-9 [&_svg]:size-4',
                sm: 'size-8 [&_svg]:size-4',
                xs: 'size-7 [&_svg]:size-4',
            },
        },
        defaultVariants: {
            variant: 'ghost',
            size: 'default',
        },
    },
);

function IconButton({
    className,
    variant,
    size,
    asChild = false,
    ...props
}: React.ComponentProps<'button'> &
    VariantProps<typeof iconButtonVariants> & {
        asChild?: boolean;
    }) {
    const Comp = asChild ? Slot : 'button';

    return (
        <Comp
            type="button"
            data-slot="icon-button"
            className={cn(iconButtonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { IconButton, iconButtonVariants };
