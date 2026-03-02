'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useRouter } from 'nextjs-toploader/app';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
        <div className="mx-auto w-full max-w-xl">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="mb-8 space-y-2 text-center"
            >
                <h1 className="text-3xl font-semibold tracking-tight">Link resources</h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    Select existing companies and stakeholders to include in your new project.
                </p>
            </motion.div>

            <form onSubmit={onSubmit}>
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
                >
                    <Card className="border-neutral-900 bg-neutral-900/50 shadow-xl backdrop-blur mb-10 py-0">
                        <CardContent className="px-0">
                            <ResourceSelectList
                                selectedIds={selectedResourceIds}
                                onToggle={handleToggle}
                                onClearAll={handleClearAll}
                            />
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
                    className="flex flex-col items-center gap-7"
                >
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
                        Skip, create without resources
                    </button>
                </motion.div>
            </form>
        </div>
    );
}
