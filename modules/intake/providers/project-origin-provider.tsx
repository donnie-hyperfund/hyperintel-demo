'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { importArtifacts } from '@/lib/api/requests/worker/projects';
import { buildProjectReturnHref, type ProjectOrigin } from '@/lib/intake/project-origin';
import { ImportResultSchema } from '@/lib/schema/project';

type ProjectOriginContextValue = {
    origin: ProjectOrigin | null;
    isProjectFlow: boolean;
    backHref: string | null;
    parent: { label: string; href: string } | null;
    infoText: string | null;
    isLinking: boolean;
    handleApprovedArtifact: (artifact: { id: string; key: string }) => Promise<void>;
};

type ProjectOriginProviderProps = {
    origin: ProjectOrigin | null;
    resourceType: 'company' | 'stakeholder';
    children: ReactNode;
};

const emptyProjectOrigin: ProjectOriginContextValue = {
    origin: null,
    isProjectFlow: false,
    backHref: null,
    parent: null,
    infoText: null,
    isLinking: false,
    handleApprovedArtifact: async () => {},
};

const ProjectOriginContext = createContext<ProjectOriginContextValue>(emptyProjectOrigin);

const resourceLabels = {
    company: 'Company profile',
    stakeholder: 'Stakeholder profile',
} as const;

export function ProjectOriginProvider({ origin, resourceType, children }: ProjectOriginProviderProps) {
    const { getToken } = useAuth();
    const router = useRouter();
    const [isLinking, setIsLinking] = useState(false);

    const resourceLabel = resourceLabels[resourceType];
    const backHref = origin ? buildProjectReturnHref(origin) : null;

    const handleApprovedArtifact = useCallback(
        async (artifact: { id: string; key: string }) => {
            if (!origin) return;

            setIsLinking(true);

            try {
                const token = await getToken();
                if (!token) throw new Error('Not authenticated');

                const response = await importArtifacts(
                    { projectId: origin.projectId, artifactIds: [artifact.id] },
                    token,
                );
                const payload = await response.json().catch(() => null);

                if (!response.ok) {
                    throw new Error(
                        payload &&
                            typeof payload === 'object' &&
                            'message' in payload &&
                            typeof payload.message === 'string'
                            ? payload.message
                            : 'Failed to add to Project Intel',
                    );
                }

                const parsed = ImportResultSchema.safeParse(payload);
                if (!parsed.success) {
                    throw new Error('Invalid import response');
                }

                const detail = parsed.data.details[0];
                if (detail?.status === 'error') {
                    throw new Error(detail.error || 'Failed to add to Project Intel');
                }

                if (detail?.status === 'skipped_duplicate') {
                    toast({ title: `${resourceLabel} approved. Matching Project Intel already exists.` });
                } else {
                    toast({ title: `${resourceLabel} approved and added to Project Intel.` });
                }

                router.push(buildProjectReturnHref(origin, { highlightResource: detail?.key ?? artifact.key }));
            } catch (error) {
                console.error('[project-origin] Failed to add approved artifact to project:', error);
                toast({
                    title: `${resourceLabel} approved, but we couldn't add it to Project Intel.`,
                    description: 'You can return to the project and link it manually.',
                    variant: 'destructive',
                });
            } finally {
                setIsLinking(false);
            }
        },
        [getToken, origin, resourceLabel, router],
    );

    const value = useMemo<ProjectOriginContextValue>(
        () => ({
            origin,
            isProjectFlow: !!origin,
            backHref,
            parent: backHref ? { label: 'Project', href: backHref } : null,
            infoText: origin ? `After approval, we'll add this ${resourceLabel.toLowerCase()} to Project Intel.` : null,
            isLinking,
            handleApprovedArtifact,
        }),
        [backHref, handleApprovedArtifact, isLinking, origin, resourceLabel],
    );

    return <ProjectOriginContext.Provider value={value}>{children}</ProjectOriginContext.Provider>;
}

export function useOptionalProjectOrigin(): ProjectOriginContextValue {
    return useContext(ProjectOriginContext);
}
