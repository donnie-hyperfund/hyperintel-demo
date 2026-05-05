import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Incomplete stakeholder conversations'),
};

export default function StakeholdersIncompleteLayout({ children }: { children: ReactNode }) {
    return children;
}
