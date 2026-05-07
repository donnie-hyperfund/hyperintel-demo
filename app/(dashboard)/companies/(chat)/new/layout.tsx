import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'New company',
};

export default function NewCompanyLayout({ children }: { children: ReactNode }) {
    return children;
}
