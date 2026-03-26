'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'nextjs-toploader/app';

import { useForm } from 'react-hook-form';
import { OnboardingStep } from '@/components/layouts/onboarding-layout/onboarding-steps';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFetchResources } from '@/lib/api/client/hooks/use-resources';
import { type CreateProjectBodyDto, CreateProjectBodySchema } from '@/lib/schema/project';
import { useProjectCreationWizard } from './_providers/project-creation-wizard-provider';

export default function NewProjectPage() {
    const router = useRouter();
    const { data, updateData, submitProject, isSubmitting } = useProjectCreationWizard();
    const { companies, stakeholders, legacyDna } = useFetchResources({
        limit: 20,
        approvedOnly: true,
        documentType: ['Legacy DNA', 'Company Profile', 'Human Persona'],
    });
    const hasResources = companies.length > 0 || stakeholders.length > 0 || legacyDna.length > 0;

    const {
        register,
        handleSubmit,
        formState: { errors, isValid },
    } = useForm<CreateProjectBodyDto>({
        resolver: zodResolver(CreateProjectBodySchema),
        mode: 'onChange',
        defaultValues: {
            name: data.name ?? '',
            description: data.description ?? '',
        },
    });

    const onSubmit = handleSubmit((formData) => {
        if (hasResources) {
            updateData(formData);
            router.push('/projects/new/resources');
        } else {
            submitProject(formData);
        }
    });

    return (
        <OnboardingStep.Root>
            <OnboardingStep.Header
                title="Create a new project"
                description="Keep your chats and artifacts organized in one place, and make it easy to share context across your team."
            />

            <form onSubmit={onSubmit}>
                <OnboardingStep.Card className="self-stretch">
                    <div className="space-y-4">
                        <Field data-invalid={!!errors.name} className="gap-2">
                            <FieldLabel htmlFor="name">Project name</FieldLabel>
                            <Input
                                id="name"
                                type="text"
                                placeholder="Workspace name"
                                className="text-base"
                                aria-invalid={!!errors.name}
                                size="xl"
                                {...register('name')}
                            />
                            <FieldError errors={errors.name ? [errors.name] : undefined} />
                        </Field>

                        <Field data-invalid={!!errors.description} className="gap-2">
                            <FieldLabel htmlFor="description">Project description</FieldLabel>
                            <Textarea
                                id="description"
                                placeholder="What's this project for? (optional)"
                                className="min-h-28 text-base"
                                rows={4}
                                size="xl"
                                aria-invalid={!!errors.description}
                                {...register('description')}
                            />
                            <FieldError errors={errors.description ? [errors.description] : undefined} />
                        </Field>
                    </div>
                </OnboardingStep.Card>

                <OnboardingStep.Footer>
                    <Button
                        type="submit"
                        disabled={!isValid || isSubmitting}
                        className="w-full max-w-[24rem]"
                        size="xl"
                    >
                        {isSubmitting ? 'Creating...' : hasResources ? 'Next' : 'Create project'}
                    </Button>
                </OnboardingStep.Footer>
            </form>
        </OnboardingStep.Root>
    );
}
