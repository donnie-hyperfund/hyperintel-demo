import { deleteCookie } from 'cookies-next';
import { CURRENT_PROJECT_COOKIE_NAME } from './project';

const USER_COOKIES = [CURRENT_PROJECT_COOKIE_NAME] as const;

export function clearAllUserCookies(): void {
    for (const cookieName of USER_COOKIES) {
        void deleteCookie(cookieName, { path: '/' });
    }
}
