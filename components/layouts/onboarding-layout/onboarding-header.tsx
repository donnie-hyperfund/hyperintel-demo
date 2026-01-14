'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function OnboardingHeader() {
    const { user } = useUser();
    const { signOut } = useClerk();

    const email = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress || '';

    const handleSignOut = () => {
        signOut({ redirectUrl: '/sign-in' });
    };

    return (
        <header className="flex items-center justify-end px-6 py-4">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="hover:bg-neutral-800/40 h-13 data-[state=open]:bg-neutral-800/40 focus-visible:ring-ring rounded-md px-4 py-2 text-right transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                    >
                        <div className="text-muted-foreground text-xs">Logged in as</div>
                        <div className="text-sm font-medium">{email}</div>
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            handleSignOut();
                        }}
                    >
                        Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </header>
    );
}
