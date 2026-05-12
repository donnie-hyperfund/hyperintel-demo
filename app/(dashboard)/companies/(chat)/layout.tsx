import type { ReactNode } from 'react';
import { CompanyChatShell } from './_components/company-chat-shell';

export default function CompanyChatLayout({ children }: { children: ReactNode }) {
    return <CompanyChatShell>{children}</CompanyChatShell>;
}
