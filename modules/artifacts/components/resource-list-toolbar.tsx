'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { OwnershipFilter } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';

type ResourceListToolbarProps = {
    search: string;
    onSearchChange: (value: string) => void;
    ownership: OwnershipFilter | undefined;
    onOwnershipChange: (value: OwnershipFilter | undefined) => void;
    placeholder?: string;
    className?: string;
    compact?: boolean;
};

export function ResourceListToolbar({
    search,
    onSearchChange,
    ownership,
    onOwnershipChange,
    placeholder = 'Search by name...',
    className,
    compact,
}: ResourceListToolbarProps) {
    return (
        <div className={cn('flex flex-col gap-2', compact && 'gap-1.5', className)}>
            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={placeholder}
                    size={compact ? 'sm' : 'default'}
                    className="pl-8 pr-8"
                />
                {search && (
                    <button
                        type="button"
                        onClick={() => onSearchChange('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X className="size-3.5" />
                    </button>
                )}
            </div>
            <ToggleGroup
                type="single"
                value={ownership ?? ''}
                onValueChange={(v) => onOwnershipChange((v || undefined) as OwnershipFilter | undefined)}
                size={compact ? 'sm' : 'default'}
                className="w-full"
            >
                <ToggleGroupItem value="">All</ToggleGroupItem>
                <ToggleGroupItem value="mine">Mine</ToggleGroupItem>
                <ToggleGroupItem value="shared">Shared</ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
