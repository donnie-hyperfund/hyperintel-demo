import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Incomplete company conversations'),
};

export default function CompaniesIncompleteLayout({ children }: { children: ReactNode }) {
    return children;
}
