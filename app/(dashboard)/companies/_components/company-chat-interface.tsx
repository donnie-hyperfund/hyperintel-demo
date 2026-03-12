'use client';

import { IntakeChatInterface } from '@/app/(dashboard)/_components/intake-chat-interface';

type CompanyChatInterfaceProps = {
    title: string;
};

export function CompanyChatInterface({ title }: CompanyChatInterfaceProps) {
    return (
        <IntakeChatInterface
            title={title}
            defaultParent={{ label: 'Companies', href: '/companies' }}
            emptyTitle="Let’s build a new company profile."
            emptySubtitle="Tell us about the company or upload supporting documents. We’ll take it from there."
        />
    );
}
