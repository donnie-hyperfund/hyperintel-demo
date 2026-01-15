import { SignIn } from '@clerk/nextjs';
import { dark } from '@clerk/themes';

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
