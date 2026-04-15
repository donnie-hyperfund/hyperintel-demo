'use client';

import { useUser } from '@clerk/nextjs';
import { useEffect } from 'react';
import { identifyPostHogUser, initPostHog, isPostHogEnabled, resetPostHogUser } from '@/lib/analytics/posthog-browser';
import { frontendEnv } from '@/lib/env';

export function PostHogBootstrap() {
    const { isLoaded, user } = useUser();

    useEffect(() => {
        initPostHog();
    }, []);

    useEffect(() => {
        if (!isLoaded || !isPostHogEnabled()) return;

        if (!user) {
            resetPostHogUser();
            return;
        }

        identifyPostHogUser(user.id, {
            email: user.primaryEmailAddress?.emailAddress ?? null,
            name: user.fullName ?? null,
            app_env: frontendEnv.NEXT_PUBLIC_APP_ENV,
        });
    }, [isLoaded, user]);

    return null;
}
