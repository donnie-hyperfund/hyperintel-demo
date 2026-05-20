import type { ReactNode } from 'react';
import { PhaseChatShell } from './_components/phase-chat-shell';

type PhaseChatLayoutProps = {
    children: ReactNode;
    params: Promise<{ 'project-id': string }>;
};

export default async function PhaseChatLayout({ children, params }: PhaseChatLayoutProps) {
    const { 'project-id': projectId } = await params;

    return <PhaseChatShell projectId={projectId}>{children}</PhaseChatShell>;
}
