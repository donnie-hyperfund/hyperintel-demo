import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Incomplete company conversations',
};

export default function CompaniesIncompleteLayout({ children }: { children: ReactNode }) {
    return children;
}
