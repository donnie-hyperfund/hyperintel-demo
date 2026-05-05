import { SignUp } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import type { Metadata } from 'next';
import { formatPageTitle } from '@/lib/metadata/page-title';

export const metadata: Metadata = {
    title: formatPageTitle('Sign up'),
};

export default function SignUpPage() {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <SignUp
                routing="path"
                path="/sign-up"
                forceRedirectUrl="/launch-pad"
                appearance={{
                    baseTheme: dark,
                }}
            />
        </div>
    );
}
