import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Company chat'),
};

export default function CompanyChatLayout({ children }: { children: ReactNode }) {
    return children;
}
