import { DashboardLayout } from '@/components/layouts/dashboard-layout';
import { UserEventsInvalidator } from '@/components/user-events-invalidator';
import { DevProvider } from '@/lib/dev/dev-provider';
import { WebsocketProvider } from '@/lib/websocket/provider';
import { ArtifactProcessingProvider } from '@/modules/artifacts/processing/artifact-processing-provider';
import { ProcessingStatusBar } from '@/modules/artifacts/processing/processing-status-bar';

type DashboardLayoutProps = LayoutProps<'/'>;

export default function Layout({ children }: DashboardLayoutProps) {
    return (
        <WebsocketProvider>
            <ArtifactProcessingProvider>
                <div className="flex min-h-dvh flex-col">
                    <ProcessingStatusBar />
                    <DashboardLayout>
                        <UserEventsInvalidator />
                        <DevProvider>{children}</DevProvider>
                    </DashboardLayout>
                </div>
            </ArtifactProcessingProvider>
        </WebsocketProvider>
    );
}
