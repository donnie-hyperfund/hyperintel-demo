'use client';

import posthog from 'posthog-js';
import { frontendEnv } from '@/lib/env';

type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsProperties = Record<string, AnalyticsValue>;

let isInitialized = false;

function compactProperties(properties: AnalyticsProperties): Record<string, string | number | boolean> {
    return Object.fromEntries(
        Object.entries(properties).filter(([, value]) => value !== undefined && value !== null),
    ) as Record<string, string | number | boolean>;
}

export function isPostHogEnabled() {
    return Boolean(frontendEnv.NEXT_PUBLIC_POSTHOG_KEY && frontendEnv.NEXT_PUBLIC_POSTHOG_HOST);
}

export function initPostHog() {
    if (typeof window === 'undefined' || isInitialized || !isPostHogEnabled()) return;

    posthog.init(frontendEnv.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: frontendEnv.NEXT_PUBLIC_POSTHOG_HOST,
        capture_pageview: 'history_change',
        capture_pageleave: true,
        autocapture: true,
        person_profiles: 'identified_only',
        persistence: 'localStorage+cookie',
    });

    isInitialized = true;
}

export function identifyPostHogUser(userId: string, properties: AnalyticsProperties = {}) {
    if (!isInitialized) return;
    posthog.identify(userId, compactProperties(properties));
}

export function resetPostHogUser() {
    if (!isInitialized) return;
    posthog.reset();
}

export function capturePostHogEvent(event: string, properties: AnalyticsProperties = {}) {
    if (!isInitialized) return;
    posthog.capture(event, compactProperties(properties));
}
