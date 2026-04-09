import { OnboardingLayout } from '@/components/layouts/onboarding-layout';
import { UserEventsInvalidator } from '@/components/user-events-invalidator';
import { WebsocketProvider } from '@/lib/websocket/provider';

type LayoutProps = {
    children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
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
