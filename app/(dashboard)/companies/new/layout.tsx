import { ChatModule } from '@/modules/chat/providers/chat-module';

type NewCompanyLayoutProps = LayoutProps<'/companies/new'>;

export default function NewCompanyLayout({ children }: NewCompanyLayoutProps) {
    return (
        <ChatModule chatType="company" intakeConfig={{ framework: 'cpf' }}>
            {children}
        </ChatModule>
    );
}
