import { StakeholderChatShell } from './_components/stakeholder-chat-shell';

type StakeholderChatLayoutProps = LayoutProps<'/stakeholders'>;

export default function StakeholderChatLayout({ children }: StakeholderChatLayoutProps) {
    return <StakeholderChatShell>{children}</StakeholderChatShell>;
}
