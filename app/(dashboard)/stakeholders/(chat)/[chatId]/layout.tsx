import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
    title: 'Stakeholder chat',
};

export default function StakeholderChatLayout({ children }: { children: ReactNode }) {
    return children;
}
