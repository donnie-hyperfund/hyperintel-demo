import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { UserEventsInvalidator } from '@/components/user-events-invalidator';
import { DevProvider } from '@/lib/dev/dev-provider';
import { WebsocketProvider } from '@/lib/websocket/provider';

type DashboardLayoutProps = LayoutProps<'/'>;

export default function Layout({ children }: DashboardLayoutProps) {
    return (
        <DashboardLayout>
            <WebsocketProvider>
                <UserEventsInvalidator />
                <DevProvider>{children}</DevProvider>
            </WebsocketProvider>
        </DashboardLayout>
    );
}
