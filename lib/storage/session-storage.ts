import { createSafeStorage } from './create-safe-storage';

export const { safeGetItem, safeSetItem, safeRemoveItem, safeGetJsonItem, safeSetJsonItem } = createSafeStorage(
    () => window.sessionStorage,
);
