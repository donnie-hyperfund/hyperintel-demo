import type { LucideIcon } from 'lucide-react';
import { Building, Dna, Users } from 'lucide-react';
import { type DocumentType, RESOURCE_DOCUMENT_TYPES } from '@/lib/schema/artifact';

export type ResourceTab = {
    value: string;
    label: string;
    documentTypes: DocumentType[];
    searchLabel: string;
    icon?: LucideIcon;
};

export const RESOURCE_TABS: ResourceTab[] = [
    { value: 'all', label: 'All resources', documentTypes: [...RESOURCE_DOCUMENT_TYPES], searchLabel: 'all resources' },
    { value: 'legacy-dna', label: 'Legacy DNA', documentTypes: ['Legacy DNA'], icon: Dna, searchLabel: 'legacy DNA' },
    {
        value: 'companies',
        label: 'Companies',
        documentTypes: ['Company Profile'],
        icon: Building,
        searchLabel: 'companies',
    },
    {
        value: 'stakeholders',
        label: 'Stakeholders',
        documentTypes: ['Human Persona'],
        icon: Users,
        searchLabel: 'stakeholders',
    },
];

export const DOCUMENT_TYPE_ICON: Record<string, LucideIcon> = {
    'Legacy DNA': Dna,
    'Company Profile': Building,
    'Human Persona': Users,
};
