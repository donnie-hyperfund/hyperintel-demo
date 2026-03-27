'use client';

import { OnboardingHeader } from './onboarding-header';

type OnboardingLayoutProps = {
    children: React.ReactNode;
};

export function OnboardingLayout({ children }: OnboardingLayoutProps) {
    return (
        <div className="flex min-h-dvh flex-col">
            <OnboardingHeader />
            <div className="flex flex-1 items-start md:items-center justify-center py-6 px-4 md:px-6 pt-8 md:pt-6">
                <div className="w-full">{children}</div>
            </div>
        </div>
    );
}
