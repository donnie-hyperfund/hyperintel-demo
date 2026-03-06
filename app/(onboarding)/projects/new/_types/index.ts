import type { z } from 'zod';
import type { ResourceFormSchema, WizardDataSchema } from '../_schema';

export type ResourceFormData = z.infer<typeof ResourceFormSchema>;

export type WizardData = z.infer<typeof WizardDataSchema>;
