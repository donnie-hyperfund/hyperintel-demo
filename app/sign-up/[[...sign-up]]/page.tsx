import { SignUp } from '@clerk/nextjs';
import { dark } from '@clerk/themes';

export default function SignUpPage() {
    return (
        <div className="flex min-h-screen items-center justify-center">
            <SignUp
                routing="path"
                path="/sign-up"
                forceRedirectUrl="/projects/new"
                appearance={{
                    baseTheme: dark,
                }}
            />
        </div>
    );
}
