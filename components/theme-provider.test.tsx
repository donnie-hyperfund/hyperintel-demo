// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from './theme-provider';

const nextThemeProviderMock = vi.fn(({ children }: { children: ReactNode }) => <div>{children}</div>);

vi.mock('next-themes', () => ({
    ThemeProvider: (props: { children: ReactNode }) => nextThemeProviderMock(props),
}));

describe('ThemeProvider', () => {
    it('forwards props to next-themes provider and renders children', () => {
        render(
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <span>theme-child</span>
            </ThemeProvider>,
        );

        expect(screen.getByText('theme-child')).toBeTruthy();
        expect(nextThemeProviderMock).toHaveBeenCalled();

        const [props] = nextThemeProviderMock.mock.calls[0] ?? [];
        expect(props).toMatchObject({
            attribute: 'class',
            defaultTheme: 'system',
            enableSystem: true,
        });
    });
});
