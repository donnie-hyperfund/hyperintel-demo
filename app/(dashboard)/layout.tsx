import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { UserEventsInvalidator } from '@/components/user-events-invalidator';
import { WebsocketProvider } from '@/lib/websocket/provider';
import { ModelSelectionProvider } from '@/modules/chat/providers/model-selection-provider';

type DashboardLayoutProps = LayoutProps<'/'>;

export default function Layout({ children }: DashboardLayoutProps) {
    return (
        <DashboardLayout>
            <WebsocketProvider>
                <UserEventsInvalidator />
                <ModelSelectionProvider>{children}</ModelSelectionProvider>
            </WebsocketProvider>
        </DashboardLayout>
    );
}
