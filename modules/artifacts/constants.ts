import { Building, CircleCheck, Dna, FileText, Users } from 'lucide-react';
import type { DocumentType } from '@/lib/schema/artifact';

export const DOCUMENT_TYPE_ICONS: Partial<Record<DocumentType, typeof FileText>> = {
    'Company Profile': Building,
    'Human Persona': Users,
    'Legacy DNA': Dna,
    'Completion Brief': CircleCheck,
};

export const DEFAULT_DOCUMENT_TYPE_ICON = FileText;
