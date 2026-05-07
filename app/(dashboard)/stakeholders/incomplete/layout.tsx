import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Incomplete stakeholder conversations',
};

export default function StakeholdersIncompleteLayout({ children }: { children: ReactNode }) {
    return children;
}
