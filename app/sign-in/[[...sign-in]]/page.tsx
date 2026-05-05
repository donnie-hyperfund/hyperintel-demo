import { SignIn } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import type { Metadata } from 'next';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Sign in'),
};

export default function SignInPage() {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <SignIn
                routing="path"
                path="/sign-in"
                appearance={{
                    baseTheme: dark,
                }}
            />
        </div>
    );
}
