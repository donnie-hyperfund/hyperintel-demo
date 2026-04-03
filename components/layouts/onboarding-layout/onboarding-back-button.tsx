'use client';

import { ChevronLeft } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useRouter } from 'nextjs-toploader/app';
import { IconButton } from '@/components/ui/icon-button';

const ROOT_PAGES = new Set(['/launch-pad']);

export function OnboardingBackButton() {
    const pathname = usePathname();
    const router = useRouter();

    if (ROOT_PAGES.has(pathname)) return null;

    return (
        <IconButton variant="light" onClick={() => router.back()}>
            <ChevronLeft />
        </IconButton>
    );
}
