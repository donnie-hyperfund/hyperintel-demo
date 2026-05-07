import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Company chat',
};

export default function CompanyChatLayout({ children }: { children: ReactNode }) {
    return children;
}
