import type { ReactNode } from 'react';
import { StakeholderChatShell } from './_components/stakeholder-chat-shell';

export default function StakeholderChatLayout({ children }: { children: ReactNode }) {
    return <StakeholderChatShell>{children}</StakeholderChatShell>;
}
