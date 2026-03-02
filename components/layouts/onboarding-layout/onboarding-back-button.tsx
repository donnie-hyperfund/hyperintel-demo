'use client';

import { ChevronLeft } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'nextjs-toploader/app';
import { Button } from '@/components/ui/button';

export function OnboardingBackButton() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();

    const isOnboarding = pathname === '/projects/new' && searchParams.get('onboarding') === 'true';

    if (isOnboarding) return null;

    return (
        <Button variant="ghost-light" size="icon" onClick={() => router.back()}>
            <ChevronLeft className="size-6" />
        </Button>
    );
}
