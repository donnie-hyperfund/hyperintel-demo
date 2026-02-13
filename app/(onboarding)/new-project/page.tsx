'use client';

import { useUser } from '@clerk/nextjs';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useCreateProject } from '@/lib/api/client/hooks/use-projects';
import { setCurrentProjectCookie } from '@/lib/cookies/project';
import { type CreateProjectBodyDto, CreateProjectBodySchema } from '@/lib/schema/project';

export default function NewProjectPage() {
    const router = useRouter();
    const { user } = useUser();
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
        if (!user?.id) {
            toast({
                title: 'You must be logged in to create a project.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const newProject = await createProject(data);

            toast({
                title: 'Project created successfully!',
            });

            // Set the current project cookie and redirect to the new project
            setCurrentProjectCookie(user.id, newProject.id);
            router.push(`/${newProject.id}`);
        } catch (error) {
            console.error('Failed to create project:', error);
            toast({
                title: 'Failed to create project. Please try again.',
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="mx-auto w-full max-w-md">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="mb-8 space-y-2 text-center"
            >
                <h1 className="text-3xl font-semibold tracking-tight">Create a new project</h1>
                <p className="text-muted-foreground text-sm leading-relaxed">
                    Keep your chats and artifacts organized in one place, and make it easy to share context across your
                    team.
                </p>
            </motion.div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col items-center justify-center">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
                    className="self-stretch"
                >
                    <Card className="border-neutral-900 bg-neutral-900/50 shadow-xl backdrop-blur mb-10 py-7">
                        <CardContent className="px-7">
                            <div className="space-y-4">
                                <Field data-invalid={!!errors.name} className="gap-2">
                                    <FieldLabel htmlFor="name">Project name</FieldLabel>
                                    <Input
                                        id="name"
                                        type="text"
                                        placeholder="Workspace name"
                                        disabled={isMutating}
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
                                        disabled={isMutating}
                                        className="min-h-28 text-base"
                                        rows={4}
                                        size="xl"
                                        aria-invalid={!!errors.description}
                                        {...register('description')}
                                    />
                                    <FieldError errors={errors.description ? [errors.description] : undefined} />
                                </Field>
                            </div>
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
                    className="self-stretch flex justify-center"
                >
                    <Button type="submit" disabled={isMutating || !isValid} className="w-full max-w-[24rem]" size="xl">
                        {isMutating ? 'Creating...' : 'Create project'}
                    </Button>
                </motion.div>
            </form>
        </div>
    );
}
