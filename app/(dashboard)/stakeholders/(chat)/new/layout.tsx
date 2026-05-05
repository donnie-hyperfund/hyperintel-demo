import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('New stakeholder'),
};

export default function NewStakeholderLayout({ children }: { children: ReactNode }) {
    return children;
}
