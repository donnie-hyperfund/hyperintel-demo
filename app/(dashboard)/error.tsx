'use client';

import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { AppErrorScreen } from '@/components/ui/app-error-screen';
import { Button } from '@/components/ui/button';
import { useSignOut } from '@/hooks/use-sign-out';

export default function DashboardError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
    const { isSignedIn } = useAuth();
    const { signOut } = useSignOut();
    const hasErrorId = !!error.digest?.trim();

    const handleSignOut = async () => {
        await signOut();
        window.location.reload();
    };

    return (
        <AppErrorScreen
            title="Something went wrong"
            description={
                isSignedIn
                    ? hasErrorId
                        ? 'An unexpected error occurred. Return to the dashboard, or copy the error ID for tracing.'
                        : 'An unexpected error occurred. Return to the dashboard.'
                    : hasErrorId
                      ? 'An unexpected error occurred. Return to sign in, or copy the error ID for tracing.'
                      : 'An unexpected error occurred. Return to sign in.'
            }
            referenceItems={[{ label: 'Error ID', value: error.digest }]}
            primaryAction={
                isSignedIn ? (
                    <Button asChild size="lg">
                        <Link href="/launch-pad">Go to Dashboard</Link>
                    </Button>
                ) : (
                    <Button asChild size="lg">
                        <Link href="/sign-in">Go to Sign In</Link>
                    </Button>
                )
            }
            secondaryAction={
                isSignedIn ? (
                    <button
                        type="button"
                        className="cursor-pointer text-sm text-white/56 underline underline-offset-4 transition-colors hover:text-white/84"
                        onClick={handleSignOut}
                    >
                        Sign out
                    </button>
                ) : undefined
            }
        />
    );
}
