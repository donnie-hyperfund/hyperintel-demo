'use client';

import { useAuth } from '@clerk/nextjs';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useSignOut } from '@/hooks/use-sign-out';

export default function DashboardError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
    const { isSignedIn } = useAuth();
    const { signOut } = useSignOut();

    const handleSignOut = async () => {
        await signOut();
        window.location.reload();
    };

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
            <div className="mb-6 flex size-16 items-center justify-center rounded-5 bg-neutral-800/60">
                <TriangleAlert className="size-6 opacity-75" strokeWidth={1.5} />
            </div>
            <div className="mb-8 space-y-1.5">
                <h1 className="text-lg font-medium text-neutral-200">Something went wrong</h1>
                <p className="max-w-xs text-sm text-neutral-500">
                    An unexpected error occurred.
                    {isSignedIn
                        ? ' You can return to the dashboard or sign out.'
                        : ' You can go to the sign in page to continue.'}
                    {error.digest && <span className="mt-2 block text-xs">Error ID: {error.digest}</span>}
                </p>
            </div>
            <div className="flex flex-col items-center gap-4">
                {isSignedIn ? (
                    <>
                        <Button asChild>
                            <Link href="/launch-pad">Go to Dashboard</Link>
                        </Button>
                        <button
                            type="button"
                            className="cursor-pointer text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-200"
                            onClick={handleSignOut}
                        >
                            Sign out
                        </button>
                    </>
                ) : (
                    <Button asChild>
                        <Link href="/sign-in">Go to Sign In</Link>
                    </Button>
                )}
            </div>
        </div>
    );
}
