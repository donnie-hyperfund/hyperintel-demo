import { createSafeStorage } from './create-safe-storage';

export const { safeGetItem, safeSetItem, safeRemoveItem, safeGetJsonItem, safeSetJsonItem, storageKey } =
    createSafeStorage(() => window.localStorage);
