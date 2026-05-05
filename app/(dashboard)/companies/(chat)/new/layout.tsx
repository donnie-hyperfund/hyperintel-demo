import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('New company'),
};

export default function NewCompanyLayout({ children }: { children: ReactNode }) {
    return children;
}
