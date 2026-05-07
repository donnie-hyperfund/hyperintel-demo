import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Stakeholder personas',
};

export default function StakeholdersLayout({ children }: { children: ReactNode }) {
    return children;
}
