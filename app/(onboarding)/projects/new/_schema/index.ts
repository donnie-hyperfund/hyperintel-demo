import { z } from 'zod';
import { CreateProjectBodySchema } from '@/lib/schema/project';

export const ResourceFormSchema = z.object({
    selectedResourceIds: z.array(z.string().uuid()).default([]),
});

export const WizardDataSchema = CreateProjectBodySchema.merge(ResourceFormSchema);
