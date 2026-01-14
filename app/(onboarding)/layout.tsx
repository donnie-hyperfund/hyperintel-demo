import { OnboardingLayout } from '@/components/layouts/onboarding-layout';

type LayoutProps = {
    children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
    return <OnboardingLayout>{children}</OnboardingLayout>;
}
