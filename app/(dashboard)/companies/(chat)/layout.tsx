import { CompanyChatShell } from './_components/company-chat-shell';

type CompanyChatLayoutProps = LayoutProps<'/companies'>;

export default function CompanyChatLayout({ children }: CompanyChatLayoutProps) {
    return <CompanyChatShell>{children}</CompanyChatShell>;
}
