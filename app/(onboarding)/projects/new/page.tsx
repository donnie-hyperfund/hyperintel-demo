'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { type CreateProjectBodyDto, CreateProjectBodySchema } from '@/lib/schema/project';
import { useProjectCreationWizard } from './_providers/project-creation-wizard-provider';

export default function NewProjectPage() {
    const router = useRouter();
    const { data, updateData } = useProjectCreationWizard();

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
        updateData(formData);
        router.push('/projects/new/resources');
    });

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
                    Keep your chats and deliverables organized in one place, and make it easy to share context across
                    your team.
                </p>
            </motion.div>

            <form onSubmit={onSubmit} className="flex flex-col items-center justify-center">
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
                        </CardContent>
                    </Card>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4, ease: 'easeOut' }}
                    className="self-stretch flex justify-center"
                >
                    <Button type="submit" disabled={!isValid} className="w-full max-w-[24rem]" size="xl">
                        Next
                    </Button>
                </motion.div>
            </form>
        </div>
    );
}
