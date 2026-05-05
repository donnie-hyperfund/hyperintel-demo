import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type React from 'react';
import 'katex/dist/katex.min.css';
import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';
import NextTopLoader from 'nextjs-toploader';
import { PostHogBootstrap } from '@/components/analytics/posthog-bootstrap';
import { Toaster } from '@/components/ui/toaster';
import { APP_TITLE } from '@/lib/metadata/page-title';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
    title: {
        default: APP_TITLE,
        template: `%s | ${APP_TITLE}`,
    },
    description: 'AI-powered strategic intelligence platform',
    icons: {
        icon: '/favicon.ico',
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" afterSignOutUrl="/sign-in">
            <html lang="en" className="dark">
                <body className={`${inter.variable} font-sans antialiased`}>
                    <NextTopLoader color="oklch(0.69 0.19 145)" showSpinner={false} shadow={false} zIndex={100} />
                    <PostHogBootstrap />
                    {children}
                    <Analytics />
                    <Toaster />
                </body>
            </html>
        </ClerkProvider>
    );
}
