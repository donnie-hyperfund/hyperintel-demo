import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Stakeholder chat'),
};

export default function StakeholderChatLayout({ children }: { children: ReactNode }) {
    return children;
}
