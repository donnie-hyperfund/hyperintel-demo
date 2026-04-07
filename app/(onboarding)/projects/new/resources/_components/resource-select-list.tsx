'use client';

import { useResourceListFilters } from '@/hooks/use-resource-list-filters';
import { ResourcePickerPanel } from '@/modules/artifacts/components/resource-picker-panel';
import { ResourcePickerToolbar } from '@/modules/artifacts/components/resource-picker-toolbar';
import { useResourceTabs } from '@/modules/artifacts/hooks/use-resource-tabs';

type ResourceSelectListProps = {
    selectedIds: string[];
    onToggle: (id: string) => void;
    onClearAll: () => void;
};

export function ResourceSelectList({ selectedIds, onToggle, onClearAll }: ResourceSelectListProps) {
    const filters = useResourceListFilters();
    const tabState = useResourceTabs();

    return (
        <>
            <div className="px-4 py-4">
                <ResourcePickerToolbar filters={filters} tabState={tabState} />
            </div>

            <div className="flex flex-1 flex-col overflow-hidden px-4 pt-4">
                {tabState.tabs.map((tab) =>
                    tabState.activeTab === tab.value ? (
                        <ResourcePickerPanel
                            key={tab.value}
                            documentTypes={tab.documentTypes}
                            filters={filters}
                            icon={tab.icon}
                            selectedIds={selectedIds}
                            onToggle={onToggle}
                            className="h-96 overflow-y-auto py-4"
                            skeletonCount={4}
                        />
                    ) : null,
                )}
            </div>

            {selectedIds.length > 0 && (
                <div className="flex items-center justify-between px-6 py-4 bg-neutral-900">
                    <span className="text-sm font-medium text-white">{selectedIds.length} resources selected</span>
                    <button
                        type="button"
                        onClick={onClearAll}
                        className="text-primary hover:text-primary/80 text-sm transition-colors cursor-pointer"
                    >
                        Deselect all
                    </button>
                </div>
            )}
        </>
    );
}
