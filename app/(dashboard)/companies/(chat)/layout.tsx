import { type ReactNode, Suspense } from 'react';
import { CompanyChatShell } from './_components/company-chat-shell';

export default function CompanyChatLayout({ children }: { children: ReactNode }) {
    return (
        <Suspense>
            <CompanyChatShell>{children}</CompanyChatShell>
        </Suspense>
    );
}
