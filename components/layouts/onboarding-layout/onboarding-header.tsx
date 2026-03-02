'use client';

import { useUser } from '@clerk/nextjs';
import { ChevronLeft } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useRouter } from 'nextjs-toploader/app';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSignOut } from '@/hooks/use-sign-out';
import { cn } from '@/lib/utils';

export function OnboardingHeader() {
    const { user } = useUser();
    const { signOut } = useSignOut();

    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();

    const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || '';
    const shouldShowBackButton = pathname !== '/projects/new' || searchParams.get('onboarding') !== 'true';

    return (
        <header className={cn('flex items-center px-6 py-4', shouldShowBackButton ? 'justify-between' : 'justify-end')}>
            {shouldShowBackButton && (
                <Button variant="ghost-light" size="icon" onClick={() => router.back()}>
                    <ChevronLeft className="size-6" />
                </Button>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="hover:bg-neutral-800/40 h-13 data-[state=open]:bg-neutral-800/40 focus-visible:ring-ring rounded-2 px-4 py-2 text-right transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                    >
                        <div className="text-muted-foreground text-xs">Logged in as</div>
                        <div className="text-sm font-medium">{email}</div>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            signOut();
                        }}
                    >
                        Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}
