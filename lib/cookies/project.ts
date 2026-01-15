import { deleteCookie, getCookie, setCookie } from 'cookies-next';

export const CURRENT_PROJECT_COOKIE_NAME = 'current-project';

const COOKIE_OPTIONS = {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year in seconds
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
};

type ProjectCookieValue = {
    userId: string;
    projectId: string;
};

export function setCurrentProjectCookie(userId: string, projectId: string): void {
    setCookie(CURRENT_PROJECT_COOKIE_NAME, `${userId}:${projectId}`, COOKIE_OPTIONS);
}

export function getCurrentProjectFromCookie(): ProjectCookieValue | null {
    const value = getCookie(CURRENT_PROJECT_COOKIE_NAME);
    if (typeof value !== 'string') return null;

    const [userId, projectId] = value.split(':');
    if (!userId || !projectId) return null;

    return { userId, projectId };
}

export function parseProjectCookie(value: string | undefined): ProjectCookieValue | null {
    if (!value) return null;

    const [userId, projectId] = value.split(':');
    if (!userId || !projectId) return null;

    return { userId, projectId };
}

export function clearCurrentProjectCookie(): void {
    deleteCookie(CURRENT_PROJECT_COOKIE_NAME, { path: '/' });
}
