import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Add to Project Intel'),
};

export default function ProjectResourcesLayout({ children }: { children: ReactNode }) {
    return children;
}
