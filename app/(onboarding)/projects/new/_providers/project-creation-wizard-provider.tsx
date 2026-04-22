'use client';

import { useAuth, useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { createProjectApi } from '@/lib/api/client/fetchers/projects';
import { importArtifacts } from '@/lib/api/requests/worker/projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import type { WizardData } from '../_types';

type WizardContextValue = {
    data: Partial<WizardData>;
    updateData: (patch: Partial<WizardData>) => void;
    submitProject: (finalData?: Partial<WizardData>) => Promise<void>;
    isSubmitting: boolean;
};

const WizardContext = createContext<WizardContextValue | null>(null);

export function ProjectCreationWizardProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const { user } = useUser();
    const { getToken } = useAuth();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [data, setData] = useState<Partial<WizardData>>({});

    const updateData = useCallback((patch: Partial<WizardData>) => {
        setData((prev) => ({ ...prev, ...patch }));
    }, []);

    const submitProject = useCallback(
        async (finalData?: Partial<WizardData>) => {
            if (!user?.id) {
                toast({ title: 'You must be logged in to create a project.', variant: 'destructive' });
                return;
            }

            const merged = { ...data, ...finalData };

            if (!merged.name) {
                toast({ title: 'Project details are missing.', variant: 'destructive' });
                return;
            }

            if (isSubmitting) return;
            setIsSubmitting(true);

            try {
                const api = createProjectApi(getToken);
                const newProject = await api.create({ name: merged.name, description: merged.description });

                const ids = merged.selectedResourceIds ?? [];
                if (ids.length > 0) {
                    const token = await getToken();
                    if (!token) throw new Error('Not authenticated');

                    const response = await importArtifacts({ projectId: newProject.id, artifactIds: ids }, token);
                    if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.message || 'Failed to import artifacts');
                    }
                }

                toast({ title: 'Project created successfully!' });

                setCurrentProjectCookie(user.id, newProject.id);
                router.push(`/${newProject.id}`);
            } catch (error) {
                console.error('Failed to create project:', error);
                toast({ title: 'Failed to create project. Please try again.', variant: 'destructive' });
                setIsSubmitting(false);
            }
        },
        [data, user, getToken, router, isSubmitting],
    );

    return (
        <WizardContext.Provider value={{ data, updateData, submitProject, isSubmitting }}>
            {children}
        </WizardContext.Provider>
    );
}

export function useProjectCreationWizard() {
    const context = useContext(WizardContext);
    if (!context) throw new Error('useProjectCreationWizard must be used within ProjectCreationWizardProvider');
    return context;
}
