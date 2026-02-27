import { ChatModule } from '@/modules/chat/providers/chat-module';

type CompanyChatLayoutProps = LayoutProps<'/companies/[chatId]'>;

export default async function CompanyChatLayout({ children, params }: CompanyChatLayoutProps) {
    const { chatId } = await params;

    return (
        <ChatModule chatType="company" initialChatId={chatId}>
            {children}
        </ChatModule>
    );
}
