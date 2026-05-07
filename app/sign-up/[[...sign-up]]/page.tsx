import { SignUp } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Sign up',
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
