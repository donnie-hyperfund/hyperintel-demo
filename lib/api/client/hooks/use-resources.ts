import type { ArtifactDto } from '@/lib/schema/artifact';

const MOCK_COMPANIES: ArtifactDto[] = [
    {
        id: 'mock-company-1',
        key: 'acme-corp',
        title: 'Acme Corporation',
        version: 1,
        current_version: { id: 'v1', version: 1, content: '', status: 'approved', document_type: 'Company Profile', created_at: '2025-01-15T10:00:00Z', updated_at: '2025-01-15T10:00:00Z' },
        created_at: '2025-01-15T10:00:00Z',
        updated_at: '2025-01-15T10:00:00Z',
    },
    {
        id: 'mock-company-2',
        key: 'globex-industries',
        title: 'Globex Industries',
        version: 1,
        current_version: { id: 'v2', version: 1, content: '', status: 'approved', document_type: 'Company Profile', created_at: '2025-02-01T10:00:00Z', updated_at: '2025-02-01T10:00:00Z' },
        created_at: '2025-02-01T10:00:00Z',
        updated_at: '2025-02-01T10:00:00Z',
    },
    {
        id: 'mock-company-3',
        key: 'initech-solutions',
        title: 'Initech Solutions',
        version: 1,
        current_version: { id: 'v3', version: 1, content: '', status: 'approved', document_type: 'Company Profile', created_at: '2025-02-20T10:00:00Z', updated_at: '2025-02-20T10:00:00Z' },
        created_at: '2025-02-20T10:00:00Z',
        updated_at: '2025-02-20T10:00:00Z',
    },
];

const MOCK_STAKEHOLDERS: ArtifactDto[] = [
    {
        id: 'mock-stakeholder-1',
        key: 'john-smith',
        title: 'John Smith — CEO, Acme Corporation',
        version: 1,
        current_version: { id: 'v4', version: 1, content: '', status: 'approved', document_type: 'Human Persona', created_at: '2025-01-16T10:00:00Z', updated_at: '2025-01-16T10:00:00Z' },
        created_at: '2025-01-16T10:00:00Z',
        updated_at: '2025-01-16T10:00:00Z',
    },
    {
        id: 'mock-stakeholder-2',
        key: 'sarah-chen',
        title: 'Sarah Chen — VP Engineering, Globex',
        version: 1,
        current_version: { id: 'v5', version: 1, content: '', status: 'approved', document_type: 'Human Persona', created_at: '2025-02-02T10:00:00Z', updated_at: '2025-02-02T10:00:00Z' },
        created_at: '2025-02-02T10:00:00Z',
        updated_at: '2025-02-02T10:00:00Z',
    },
    {
        id: 'mock-stakeholder-3',
        key: 'michael-torres',
        title: 'Michael Torres — CFO, Initech Solutions',
        version: 1,
        current_version: { id: 'v6', version: 1, content: '', status: 'approved', document_type: 'Human Persona', created_at: '2025-02-21T10:00:00Z', updated_at: '2025-02-21T10:00:00Z' },
        created_at: '2025-02-21T10:00:00Z',
        updated_at: '2025-02-21T10:00:00Z',
    },
    {
        id: 'mock-stakeholder-4',
        key: 'lisa-park',
        title: 'Lisa Park — Head of Strategy, Acme',
        version: 1,
        current_version: { id: 'v7', version: 1, content: '', status: 'approved', document_type: 'Human Persona', created_at: '2025-03-05T10:00:00Z', updated_at: '2025-03-05T10:00:00Z' },
        created_at: '2025-03-05T10:00:00Z',
        updated_at: '2025-03-05T10:00:00Z',
    },
];

export function useFetchResources() {
    return {
        companies: MOCK_COMPANIES,
        stakeholders: MOCK_STAKEHOLDERS,
        isLoading: false,
        error: undefined as Error | undefined,
    };
}
