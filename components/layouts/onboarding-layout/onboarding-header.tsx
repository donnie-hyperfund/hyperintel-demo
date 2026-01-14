'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

export function OnboardingHeader() {
    const { user } = useUser();
    const { signOut } = useClerk();

    const handleSignOut = () => {
        signOut({ redirectUrl: '/sign-in' });
    };

    return (
        <header className="flex items-center justify-between border-b px-6 py-4">
            <div className="text-sm text-muted-foreground">
                {user?.primaryEmailAddress?.emailAddress || user?.emailAddresses[0]?.emailAddress}
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
                Log out
            </Button>
        </header>
    );
}
