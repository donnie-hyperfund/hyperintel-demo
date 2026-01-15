import { useClerk } from '@clerk/nextjs';
import { useCallback } from 'react';
import { clearAllUserCookies } from '@/lib/cookies/user-cookies';

type UseSignOutOptions = {
    redirectUrl?: string;
};

export function useSignOut(options: UseSignOutOptions = {}) {
    const { redirectUrl = '/sign-in' } = options;
    const { signOut } = useClerk();

    const handleSignOut = useCallback(() => {
        clearAllUserCookies();
        signOut({ redirectUrl });
    }, [signOut, redirectUrl]);

    return { signOut: handleSignOut };
}
