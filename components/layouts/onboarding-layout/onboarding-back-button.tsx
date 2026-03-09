'use client';

import { ChevronLeft } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useRouter } from 'nextjs-toploader/app';
import { Button } from '@/components/ui/button';

const ROOT_PAGES = new Set(['/launch-pad']);

export function OnboardingBackButton() {
    const pathname = usePathname();
    const router = useRouter();

    if (ROOT_PAGES.has(pathname)) return null;

    return (
        <Button variant="ghost-light" size="icon" onClick={() => router.back()}>
            <ChevronLeft className="size-6" />
        </Button>
    );
}
