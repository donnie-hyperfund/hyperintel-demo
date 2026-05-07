import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Add to Project Intel',
};

export default function ProjectResourcesLayout({ children }: { children: ReactNode }) {
    return children;
}
