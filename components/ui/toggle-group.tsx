'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const toggleGroupItemVariants = cva(
    'text-muted-foreground inline-flex min-w-0 flex-1 shrink-0 cursor-pointer items-center justify-center rounded-2 px-3 font-medium whitespace-nowrap transition-all outline-none hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm focus-visible:ring-ring/50 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
    {
        variants: {
            size: {
                default: 'h-8 text-sm',
                sm: 'h-7 text-xs',
                lg: 'h-9 text-sm',
            },
        },
        defaultVariants: {
            size: 'default',
        },
    },
);

type ToggleGroupItemSize = VariantProps<typeof toggleGroupItemVariants>['size'];

const ToggleGroupContext = React.createContext<{ size?: ToggleGroupItemSize }>({});

function ToggleGroup({
    className,
    size,
    children,
    ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & { size?: ToggleGroupItemSize }) {
    return (
        <ToggleGroupPrimitive.Root
            data-slot="toggle-group"
            data-size={size}
            className={cn(
                'bg-muted group/toggle-group inline-flex w-fit items-center gap-0.5 rounded-2.5 p-0.5',
                className,
            )}
            {...props}
        >
            <ToggleGroupContext.Provider value={{ size }}>{children}</ToggleGroupContext.Provider>
        </ToggleGroupPrimitive.Root>
    );
}

function ToggleGroupItem({
    className,
    children,
    size,
    ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & { size?: ToggleGroupItemSize }) {
    const context = React.useContext(ToggleGroupContext);

    return (
        <ToggleGroupPrimitive.Item
            data-slot="toggle-group-item"
            data-size={context.size || size}
            className={cn(toggleGroupItemVariants({ size: context.size || size }), className)}
            {...props}
        >
            {children}
        </ToggleGroupPrimitive.Item>
    );
}

export { ToggleGroup, ToggleGroupItem };
