'use client';

import { useAuth } from '@clerk/nextjs';
import type { LucideIcon } from 'lucide-react';
import { Building, Building2, Dna, Loader2, Plus, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
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
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useFetchProjectResources } from '@/lib/api/client/hooks/use-project-resources';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import { importArtifacts } from '@/lib/api/requests/worker/projects';
import type { ArtifactDto } from '@/lib/schema/artifact';
import { ArtifactListItem, ArtifactListItemSkeleton } from '@/modules/artifacts/components/artifact-list-item';

type LinkResourceDialogParams = PageParams<'/[project-id]'>;

export function LinkResourceDialog() {
    const { 'project-id': projectId } = useParams<LinkResourceDialogParams>();
    const { getToken } = useAuth();
    const [open, setOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isImporting, setIsImporting] = useState(false);

    const { companies, stakeholders, legacyDna, isLoading } = useFetchResources({ limit: 20, approvedOnly: true });
    const { allItems: projectResources, mutate: mutateProjectResources } = useFetchProjectResources(projectId);

    const alreadyLinkedKeys = useMemo(() => new Set(projectResources.map((a) => a.key)), [projectResources]);

    const availableCompanies = useMemo(
        () => companies.filter((a) => !alreadyLinkedKeys.has(a.key)),
        [companies, alreadyLinkedKeys],
    );
    const availableStakeholders = useMemo(
        () => stakeholders.filter((a) => !alreadyLinkedKeys.has(a.key)),
        [stakeholders, alreadyLinkedKeys],
    );
    const availableLegacyDna = useMemo(
        () => legacyDna.filter((a) => !alreadyLinkedKeys.has(a.key)),
        [legacyDna, alreadyLinkedKeys],
    );

    const totalAvailable = availableCompanies.length + availableStakeholders.length + availableLegacyDna.length;

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

    const handleOpenChange = useCallback((next: boolean) => {
        setOpen(next);
        if (!next) setSelectedIds([]);
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                    <Plus className="size-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add Project Intel</DialogTitle>
                    <DialogDescription>
                        Link an existing company profile or persona, or create a new one.
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-80 overflow-y-auto space-y-4 py-2">
                    {isLoading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <ArtifactListItemSkeleton key={i} size="sm" />
                            ))}
                        </div>
                    ) : totalAvailable === 0 ? (
                        <EmptyState
                            icon={Building2}
                            title="All Project Intel linked"
                            description="All available profiles and personas are already linked to this project."
                        />
                    ) : (
                        <>
                            <SelectableSection
                                title="Legacy DNA"
                                icon={Dna}
                                artifacts={availableLegacyDna}
                                selectedIds={selectedIds}
                                onToggle={handleToggle}
                            />
                            <SelectableSection
                                title="Companies"
                                icon={Building}
                                artifacts={availableCompanies}
                                selectedIds={selectedIds}
                                onToggle={handleToggle}
                            />
                            <SelectableSection
                                title="Stakeholders"
                                icon={Users}
                                artifacts={availableStakeholders}
                                selectedIds={selectedIds}
                                onToggle={handleToggle}
                            />
                        </>
                    )}
                </div>

                <DialogFooter>
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
                            `Add Project Intel`
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SelectableSection({
    title,
    icon,
    artifacts,
    selectedIds,
    onToggle,
}: {
    title: string;
    icon: LucideIcon;
    artifacts: ArtifactDto[];
    selectedIds: string[];
    onToggle: (id: string) => void;
}) {
    if (artifacts.length === 0) return null;

    return (
        <div className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</h3>
            <div className="space-y-1.5">
                {artifacts.map((artifact) => (
                    <ArtifactListItem
                        key={artifact.id}
                        artifact={artifact}
                        icon={icon}
                        size="sm"
                        isSelected={selectedIds.includes(artifact.id)}
                        shouldDisplayVersionInfo={false}
                        onClick={() => onToggle(artifact.id)}
                    />
                ))}
            </div>
        </div>
    );
}
