'use client';

import { Filter, X } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFetchChats } from '@/lib/api/client/hooks/use-chats';
import type { FilterableStatus, VisibilityFilter } from '@/lib/schema/artifact';
import { useChatContext } from '@/modules/chat/providers/chat-provider';

export type ProjectArtifactFilters = {
    visibility: VisibilityFilter[];
    status: FilterableStatus[];
    chatIds: string[];
};

export const EMPTY_FILTERS: ProjectArtifactFilters = { visibility: [], status: [], chatIds: [] };

const VISIBILITY_OPTIONS: { value: VisibilityFilter; label: string }[] = [
    { value: 'client', label: 'Client artifacts' },
    { value: 'internal', label: 'System-only' },
];

const STATUS_OPTIONS: { value: FilterableStatus; label: string }[] = [
    { value: 'proposed', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
];

export function getActiveFilterCount(filters: ProjectArtifactFilters): number {
    return filters.visibility.length + filters.status.length + filters.chatIds.length;
}

type ProjectArtifactFilterDropdownProps = {
    filters: ProjectArtifactFilters;
    onChange: (filters: ProjectArtifactFilters) => void;
};

export function ProjectArtifactFilterDropdown({ filters, onChange }: ProjectArtifactFilterDropdownProps) {
    const { projectId } = useChatContext<'phase'>();
    const { data: chatsData } = useFetchChats(projectId, { limit: 100 });

    const phases = useMemo(() => {
        if (!chatsData?.data) return [];
        return [...chatsData.data]
            .sort((a, b) => a.phase_index - b.phase_index)
            .map((chat) => ({ value: chat.id, label: `Phase ${chat.phase_index + 1}` }));
    }, [chatsData?.data]);

    const activeCount = getActiveFilterCount(filters);

    const toggle = useCallback(
        <K extends keyof ProjectArtifactFilters>(key: K, value: ProjectArtifactFilters[K][number]) => {
            const current = filters[key] as ProjectArtifactFilters[K][number][];
            const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
            onChange({ ...filters, [key]: next });
        },
        [filters, onChange],
    );

    const clearAll = useCallback(() => onChange(EMPTY_FILTERS), [onChange]);

    return (
        <Popover>
            <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 relative">
                            <Filter className="size-4" />
                            {activeCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                                    {activeCount}
                                </span>
                            )}
                        </Button>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Filter artifacts</TooltipContent>
            </Tooltip>

            <PopoverContent align="end" className="w-56 p-0">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border h-8">
                    <span className="text-xs font-medium text-muted-foreground">Filters</span>
                    {activeCount > 0 && (
                        <button
                            type="button"
                            onClick={clearAll}
                            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                            <X className="size-3" />
                            Clear all
                        </button>
                    )}
                </div>

                <div className="max-h-72 overflow-y-auto py-1">
                    <FilterSection title="Visibility">
                        {VISIBILITY_OPTIONS.map((opt) => (
                            <FilterCheckbox
                                key={opt.value}
                                label={opt.label}
                                checked={filters.visibility.includes(opt.value)}
                                onToggle={() => toggle('visibility', opt.value)}
                            />
                        ))}
                    </FilterSection>

                    <FilterSection title="Status">
                        {STATUS_OPTIONS.map((opt) => (
                            <FilterCheckbox
                                key={opt.value}
                                label={opt.label}
                                checked={filters.status.includes(opt.value)}
                                onToggle={() => toggle('status', opt.value)}
                            />
                        ))}
                    </FilterSection>

                    {phases.length > 0 && (
                        <FilterSection title="Phase">
                            {phases.map((phase) => (
                                <FilterCheckbox
                                    key={phase.value}
                                    label={phase.label}
                                    checked={filters.chatIds.includes(phase.value)}
                                    onToggle={() => toggle('chatIds', phase.value)}
                                />
                            ))}
                        </FilterSection>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{title}</span>
            <div className="mt-1 space-y-0.5">{children}</div>
        </div>
    );
}

function FilterCheckbox({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={onToggle}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-sm cursor-pointer hover:bg-accent/50 transition-colors"
        >
            <Checkbox
                checked={checked}
                onCheckedChange={onToggle}
                tabIndex={-1}
                className="size-3.5 pointer-events-none"
            />
            <span className="text-xs">{label}</span>
        </button>
    );
}
