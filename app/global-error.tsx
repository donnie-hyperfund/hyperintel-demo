'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { Inter } from 'next/font/google';
import './globals.css';
import { AppErrorScreen } from '@/components/ui/app-error-screen';
import { Button } from '@/components/ui/button';
import { useSignOut } from '@/hooks/use-sign-out';

const inter = Inter({ subsets: ['latin'] });

function ErrorContent({ error }: { error: Error & { digest?: string } }) {
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
                        <a href="/launch-pad">Go to Dashboard</a>
                    </Button>
                ) : (
                    <Button asChild size="lg">
                        <a href="/sign-in">Go to Sign In</a>
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

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
            <html lang="en" className="dark">
                <body className={`${inter.className} antialiased`}>
                    <ErrorContent error={error} />
                </body>
            </html>
        </ClerkProvider>
    );
}
