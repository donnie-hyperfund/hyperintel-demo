import { OnboardingLayout } from '@/components/layouts/onboarding-layout';

type LayoutProps = {
    children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
    return (
        <>
            <style>{`body { background-color: #0a0a0a; }`}</style>
            <OnboardingLayout>{children}</OnboardingLayout>
        </>
    );
}
