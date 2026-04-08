'use client';

import { useAuth } from '@clerk/nextjs';
import { Link, Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useResourceListFilters } from '@/hooks/use-resource-list-filters';
import { toast } from '@/hooks/use-toast';
import { useFetchProjectResources } from '@/lib/api/client/hooks/use-project-resources';
import type { CamelCaseDto } from '@/lib/api/client/types';
import { importArtifacts } from '@/lib/api/requests/worker/projects';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { ResourcePickerPanel } from '@/modules/artifacts/components/resource-picker-panel';
import { ResourcePickerToolbar } from '@/modules/artifacts/components/resource-picker-toolbar';
import { useResourceTabs } from '@/modules/artifacts/hooks/use-resource-tabs';
import { NewResourceDropdown } from './new-resource-dropdown';

type LinkResourceDialogParams = PageParams<'/[project-id]'>;

export function LinkResourceDialog() {
    const { 'project-id': projectId } = useParams<LinkResourceDialogParams>();
    const { getToken } = useAuth();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [pendingPath, setPendingPath] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    const filters = useResourceListFilters();
    const tabState = useResourceTabs();

    const { allItems: projectResources, mutate: mutateProjectResources } = useFetchProjectResources(projectId);
    const alreadyLinkedKeys = useMemo(() => new Set(projectResources.map((a) => a.key)), [projectResources]);

    const filterItem = useCallback(
        (a: CamelCaseDto<ArtifactDto>) => !alreadyLinkedKeys.has(a.key),
        [alreadyLinkedKeys],
    );

    const handleToggle = useCallback((id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }, []);

    const handleImport = useCallback(async () => {
        if (selectedIds.length === 0) return;
        setIsImporting(true);
        try {
            const token = await getToken();
            if (!token) throw new Error('Not authenticated');

            const response = await importArtifacts({ projectId, artifactIds: selectedIds }, token);
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to import artifacts');
            }

            await mutateProjectResources();
            toast({ title: `${selectedIds.length} resource(s) added to Project Intel.` });
            setSelectedIds([]);
            setOpen(false);
        } catch {
            toast({ title: 'Failed to add to Project Intel.', variant: 'destructive' });
        } finally {
            setIsImporting(false);
        }
    }, [selectedIds, getToken, projectId, mutateProjectResources]);

    const handleOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next);
            if (!next) {
                setDropdownOpen(false);
                setSelectedIds([]);
                tabState.reset();
                filters.reset();
            }
        },
        [filters, tabState],
    );

    const handleNavigate = useCallback((path: string) => {
        setPendingPath(path);
        setDropdownOpen(false);
        setSelectedIds([]);
        setOpen(false);
    }, []);

    useEffect(() => {
        if (!pendingPath || open) return;
        const path = pendingPath;
        setPendingPath(null);
        router.push(path);
    }, [pendingPath, open, router]);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <Tooltip>
                <DialogTrigger asChild>
                    <TooltipTrigger asChild>
                        <IconButton size="sm">
                            <Link />
                        </IconButton>
                    </TooltipTrigger>
                </DialogTrigger>
                <TooltipContent>Link resource</TooltipContent>
            </Tooltip>

            <DialogContent
                className="px-4 sm:px-8 sm:max-w-xl flex max-h-140 h-full flex-col"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle>Add Project Intel</DialogTitle>
                    <DialogDescription>
                        Link an existing company profile or persona, or create a new one.
                    </DialogDescription>
                </DialogHeader>

                <ResourcePickerToolbar filters={filters} tabState={tabState} />

                <div className="flex flex-1 flex-col overflow-hidden">
                    {tabState.tabs.map((tab) =>
                        tabState.activeTab === tab.value ? (
                            <ResourcePickerPanel
                                key={tab.value}
                                documentTypes={tab.documentTypes}
                                filters={filters}
                                icon={tab.icon}
                                excludeProjectId={projectId}
                                filterItem={filterItem}
                                selectedIds={selectedIds}
                                onToggle={handleToggle}
                                emptyTitle="All linked"
                                emptyDescription="All available items are already linked to this project."
                            />
                        ) : null,
                    )}
                </div>

                <DialogFooter className="sm:justify-between">
                    <NewResourceDropdown
                        projectId={projectId}
                        open={dropdownOpen}
                        onOpenChange={setDropdownOpen}
                        onNavigate={handleNavigate}
                    />
                    <Button
                        onClick={handleImport}
                        disabled={selectedIds.length === 0 || isImporting}
                        className="w-full sm:w-auto"
                    >
                        {isImporting ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                Adding...
                            </>
                        ) : (
                            'Add Project Intel'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
