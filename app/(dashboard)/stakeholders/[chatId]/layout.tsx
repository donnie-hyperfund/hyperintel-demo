import { ChatModule } from '@/modules/chat/providers/chat-module';

type StakeholderChatLayoutProps = LayoutProps<'/stakeholders/[chatId]'>;

export default async function StakeholderChatLayout({ children, params }: StakeholderChatLayoutProps) {
    const { chatId } = await params;

    return (
        <ChatModule chatType="stakeholder" initialChatId={chatId}>
            {children}
        </ChatModule>
    );
}
