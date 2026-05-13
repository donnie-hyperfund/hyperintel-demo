import { OnboardingLayout } from '@/components/layouts/onboarding-layout';
import { UserEventsInvalidator } from '@/components/user-events-invalidator';
import { WebsocketProvider } from '@/lib/websocket/provider';

type OnboardingRootLayoutProps = LayoutProps<'/'>;

export default function Layout({ children }: OnboardingRootLayoutProps) {
    return (
        <>
            <style>{`body { background-color: #0a0a0a; }`}</style>
            <OnboardingLayout>
                <WebsocketProvider>
                    <UserEventsInvalidator />
                    {children}
                </WebsocketProvider>
            </OnboardingLayout>
        </>
    );
}
