import { frontendEnv } from '@/lib/env';

export const IS_DEV = frontendEnv.NEXT_PUBLIC_APP_ENV === 'development';
export const IS_PROD = frontendEnv.NEXT_PUBLIC_APP_ENV === 'production';
