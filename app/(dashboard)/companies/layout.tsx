import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Company profiles',
};

export default function CompaniesLayout({ children }: { children: ReactNode }) {
    return children;
}
