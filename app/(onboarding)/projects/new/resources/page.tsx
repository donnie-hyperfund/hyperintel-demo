'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'nextjs-toploader/app';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { OnboardingStep } from '@/components/layouts/onboarding-layout/onboarding-steps';
import { Button } from '@/components/ui/button';
import { useProjectCreationWizard } from '../_providers/project-creation-wizard-provider';
import { ResourceFormSchema } from '../_schema';
import type { ResourceFormData } from '../_types';
import { ResourceSelectList } from './_components/resource-select-list';

export default function LinkResourcesPage() {
    const router = useRouter();
    const { data, submitProject, isSubmitting } = useProjectCreationWizard();

    const { handleSubmit, setValue, watch } = useForm<ResourceFormData>({
        resolver: zodResolver(ResourceFormSchema),
        defaultValues: {
            selectedResourceIds: data.selectedResourceIds ?? [],
        },
    });

    const selectedResourceIds = watch('selectedResourceIds');

    const handleToggle = (id: string) => {
        const current = selectedResourceIds;
        setValue('selectedResourceIds', current.includes(id) ? current.filter((r) => r !== id) : [...current, id]);
    };

    const handleClearAll = () => {
        setValue('selectedResourceIds', []);
    };

    const onSubmit = handleSubmit((formData) => submitProject(formData));
    const onSkip = () => submitProject({ selectedResourceIds: [] });

    useEffect(() => {
        if (!data.name) router.replace('/projects/new');
    }, [data.name, router]);

    if (!data.name) return null;

    return (
        <OnboardingStep.Root maxWidth="xl">
            <OnboardingStep.Header
                title="Add to Project Intel"
                description="Select existing resources to include in your project's intel."
            />

            <form onSubmit={onSubmit}>
                <OnboardingStep.Card className="mb-4 py-0 md:mb-6 md:py-0" contentClassName="px-0 md:px-0">
                    <ResourceSelectList
                        selectedIds={selectedResourceIds}
                        onToggle={handleToggle}
                        onClearAll={handleClearAll}
                    />
                </OnboardingStep.Card>

                <OnboardingStep.Footer>
                    <Button
                        type="submit"
                        size="xl"
                        className="w-full max-w-[24rem]"
                        disabled={isSubmitting || selectedResourceIds.length === 0}
                    >
                        {isSubmitting ? 'Creating...' : 'Create project'}
                    </Button>
                    <button
                        type="button"
                        className="w-full max-w-[24rem] text-neutral-500 hover:text-neutral-300 text-sm underline-offset-4 hover:underline transition-colors cursor-pointer"
                        disabled={isSubmitting}
                        onClick={onSkip}
                    >
                        Skip, create without intel
                    </button>
                </OnboardingStep.Footer>
            </form>
        </OnboardingStep.Root>
    );
}
