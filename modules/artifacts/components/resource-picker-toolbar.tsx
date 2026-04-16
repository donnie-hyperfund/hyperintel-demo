'use client';

import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { useResourceListFilters } from '@/hooks/use-resource-list-filters';
import { OwnershipFilterSchema } from '@/lib/schema/artifact';
import { cn } from '@/lib/utils';
import type { useResourceTabs } from '../hooks/use-resource-tabs';

const MINE = OwnershipFilterSchema.enum.mine;
const SHARED = OwnershipFilterSchema.enum.shared;

type ResourcePickerToolbarProps = {
    filters: ReturnType<typeof useResourceListFilters>;
    tabState: ReturnType<typeof useResourceTabs>;
    searchPlaceholder?: string;
};

export function ResourcePickerToolbar({ filters, tabState, searchPlaceholder }: ResourcePickerToolbarProps) {
    const placeholder = searchPlaceholder ?? `Search ${tabState.activeTabConfig.searchLabel}...`;

    const tabListRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const updateScrollState = useCallback(() => {
        const el = tabListRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 1);
        setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
        const el = tabListRef.current;
        if (!el) return;
        updateScrollState();
        el.addEventListener('scroll', updateScrollState, { passive: true });
        const ro = new ResizeObserver(updateScrollState);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateScrollState);
            ro.disconnect();
        };
    }, [updateScrollState]);

    const fadeMask = useMemo(() => {
        if (canScrollLeft && canScrollRight)
            return 'linear-gradient(to right, transparent, black 2rem, black calc(100% - 2rem), transparent)';
        if (canScrollLeft) return 'linear-gradient(to right, transparent, black 2rem)';
        if (canScrollRight) return 'linear-gradient(to left, transparent, black 2rem)';
        return undefined;
    }, [canScrollLeft, canScrollRight]);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={filters.search}
                        onChange={(e) => filters.setSearch(e.target.value)}
                        placeholder={placeholder}
                        size="sm"
                        className="pl-8 pr-8"
                    />
                    {filters.search && (
                        <button
                            type="button"
                            onClick={() => filters.setSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="size-3.5" />
                        </button>
                    )}
                </div>
                <Select
                    value={filters.ownership ?? 'all'}
                    onValueChange={(v) => filters.setOwnership(v === MINE || v === SHARED ? v : undefined)}
                >
                    <SelectTrigger size="sm" className="w-auto cursor-pointer">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="cursor-pointer">
                            All
                        </SelectItem>
                        <SelectItem value={MINE} className="cursor-pointer">
                            Mine
                        </SelectItem>
                        <SelectItem value={SHARED} className="cursor-pointer">
                            Shared
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div
                ref={tabListRef}
                className="flex gap-1 overflow-x-auto border-b border-border scrollbar-none"
                role="tablist"
                style={fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
            >
                {tabState.tabs.map((tab) => (
                    <button
                        key={tab.value}
                        type="button"
                        role="tab"
                        aria-selected={tabState.activeTab === tab.value}
                        onClick={() => tabState.setActiveTab(tab.value)}
                        className={cn(
                            'relative shrink-0 whitespace-nowrap px-3 pb-2.5 text-sm font-medium text-center transition-colors cursor-pointer sm:flex-1',
                            tabState.activeTab === tab.value
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground/80',
                        )}
                    >
                        {tab.label}
                        {tabState.activeTab === tab.value && (
                            <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
