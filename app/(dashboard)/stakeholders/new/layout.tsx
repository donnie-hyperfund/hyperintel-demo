import { ChatModule } from '@/modules/chat/providers/chat-module';

type NewStakeholderLayoutProps = LayoutProps<'/stakeholders/new'>;

export default function NewStakeholderLayout({ children }: NewStakeholderLayoutProps) {
    return (
        <ChatModule chatType="stakeholder" intakeConfig={{ framework: 'hpf', category: 'principal' }}>
            {children}
        </ChatModule>
    );
}
