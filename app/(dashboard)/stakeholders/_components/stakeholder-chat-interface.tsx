'use client';

import { IntakeChatInterface } from '@/app/(dashboard)/_components/intake-chat-interface';

type StakeholderChatInterfaceProps = {
    title: string;
};

export function StakeholderChatInterface({ title }: StakeholderChatInterfaceProps) {
    return (
        <IntakeChatInterface
            title={title}
            defaultParent={{ label: 'Stakeholders', href: '/stakeholders' }}
            emptyTitle="Let’s build a new stakeholder persona."
            emptySubtitle="Tell us about the stakeholder or upload supporting documents. We’ll take it from there."
        />
    );
}
