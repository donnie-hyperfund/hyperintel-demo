// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { getContextBypassForChat, setContextBypassForChat } from './context-bypass-session';

describe('context warning session bypass', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('stores and reads bypass per chat id', () => {
        setContextBypassForChat('chat-1');

        expect(getContextBypassForChat('chat-1')).toBe(true);
        expect(getContextBypassForChat('chat-2')).toBe(false);
    });
});
