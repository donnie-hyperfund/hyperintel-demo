'use client';

import { OnboardingHeader } from './onboarding-header';

type OnboardingLayoutProps = {
    children: React.ReactNode;
};

export function OnboardingLayout({ children }: OnboardingLayoutProps) {
    return (
        <div className="flex min-h-screen flex-col">
            <OnboardingHeader />
            <div className="flex flex-1 items-center justify-center p-6">
                <div className="w-full">{children}</div>
            </div>
        </div>
    );
}
