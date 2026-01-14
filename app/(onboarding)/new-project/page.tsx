'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateProject } from '@/lib/api/client/hooks/use-projects';
import { type CreateProjectBodyDto, CreateProjectBodySchema } from '@/lib/schema/project';

export default function NewProjectPage() {
    const router = useRouter();
    const { trigger: createProject, isMutating } = useCreateProject();

    const {
        register,
        handleSubmit,
        formState: { errors, isValid },
    } = useForm<CreateProjectBodyDto>({
        resolver: zodResolver(CreateProjectBodySchema),
        mode: 'onChange',
        defaultValues: {
            name: '',
            description: '',
        },
    });

    const onSubmit = async (data: CreateProjectBodyDto) => {
        try {
            await createProject(data);

            toast.success('Project created successfully!');

            // Redirect to the chat page (assuming the default route will load the new project)
            router.push('/');
        } catch (error) {
            console.error('Failed to create project:', error);
            toast.error('Failed to create project. Please try again.');
        }
    };

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-semibold tracking-tight text-center mb-10">Create your first project</h1>

            <div className="space-y-2 p-6 rounded-xl border border-green-500/20 bg-green-500/5">
                <h2 className="font-semibold text-green-600 dark:text-green-400">How to use projects</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Projects help organize your work and manage internal processes effectively. Create dedicated
                    workspaces for different initiatives, teams, or departments to keep everything structured and
                    accessible.
                </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Field data-invalid={!!errors.name} className="gap-2">
                    <FieldLabel htmlFor="name">Project name</FieldLabel>
                    <Input
                        id="name"
                        type="text"
                        placeholder="Enter a name for your project"
                        disabled={isMutating}
                        className="text-base"
                        aria-invalid={!!errors.name}
                        {...register('name')}
                    />
                    <FieldError errors={errors.name ? [errors.name] : undefined} />
                </Field>

                <Field data-invalid={!!errors.description} className="gap-2">
                    <FieldLabel htmlFor="description">Project description</FieldLabel>
                    <Textarea
                        id="description"
                        placeholder="Describe the purpose and goals of this project"
                        disabled={isMutating}
                        className="min-h-32 text-base"
                        rows={4}
                        aria-invalid={!!errors.description}
                        {...register('description')}
                    />
                    <FieldError errors={errors.description ? [errors.description] : undefined} />
                </Field>

                <div className="flex justify-end">
                    <Button type="submit" disabled={isMutating || !isValid} className="min-w-32">
                        {isMutating ? 'Creating...' : 'Create project'}
                    </Button>
                </div>
            </form>
        </div>
    );
}
