import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'New stakeholder',
};

export default function NewStakeholderLayout({ children }: { children: ReactNode }) {
    return children;
}
