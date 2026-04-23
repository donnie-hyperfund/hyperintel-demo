// @vitest-environment jsdom

import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ComponentType, ImgHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
	frontendEnv: {
		NEXT_PUBLIC_LOCAL_WORKERS: true,
		NEXT_PUBLIC_CLOUDFLARE_BASE: '',
		NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_mock',
	},
}));

vi.mock('@/lib/api/requests/worker/common', () => ({
	getWorkerUrl: vi.fn(() => 'https://worker.example/mock'),
}));

import { useMarkdownComponents } from './use-markdown-components';

describe('useMarkdownComponents image renderer', () => {
	it('recovers from a broken image when the src changes', () => {
		const { result } = renderHook(() => useMarkdownComponents({ id: 'img-test' }));
		const Img = result.current.img as ComponentType<ImgHTMLAttributes<HTMLImageElement>>;

		const { rerender } = render(<Img src="https://example.com/first.png" alt="Chart" />);

		fireEvent.error(screen.getByRole('img', { name: 'Chart' }));
		expect(screen.getByText('[Image could not be loaded]')).toBeTruthy();

		rerender(<Img src="https://example.com/second.png" alt="Chart" />);

		expect(screen.queryByText('[Image could not be loaded]')).toBeNull();
		expect(screen.getByRole('img', { name: 'Chart' }).getAttribute('src')).toBe('https://example.com/second.png');
	});
});
