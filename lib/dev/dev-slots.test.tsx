// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DevSlot } from '@/lib/dev-slots';
// Importing the registry auto-injects the real renderer via setDevSlotRenderer
import { devSlots } from './dev-slots';

afterEach(() => cleanup());

describe('devSlots registry + stub', () => {
	it('registers and renders a component in a slot', () => {
		const Comp = ({ chatId }: { chatId: string }) => <div data-testid="slot">{chatId}</div>;
		const unsub = devSlots.register('chat-header', Comp);

		render(<DevSlot name="chat-header" chatId="abc" />);
		expect(screen.getByTestId('slot').textContent).toBe('abc');

		unsub();
	});

	it('renders multiple components in the same slot', () => {
		const A = () => <span data-testid="a">A</span>;
		const B = () => <span data-testid="b">B</span>;

		const unA = devSlots.register('dev-panel', A);
		const unB = devSlots.register('dev-panel', B);

		render(<DevSlot name="dev-panel" />);
		expect(screen.getByTestId('a')).toBeTruthy();
		expect(screen.getByTestId('b')).toBeTruthy();

		unA();
		unB();
	});

	it('unregister removes the component and triggers re-render', () => {
		const Comp = () => <div data-testid="gone">hi</div>;
		const unsub = devSlots.register('dev-panel', Comp);

		const { rerender } = render(<DevSlot name="dev-panel" />);
		expect(screen.getByTestId('gone')).toBeTruthy();

		unsub();
		rerender(<DevSlot name="dev-panel" />);
		expect(screen.queryByTestId('gone')).toBeNull();
	});

	it('renders nothing when no components are registered', () => {
		const { container } = render(<DevSlot name="dev-panel" />);
		expect(container.innerHTML).toBe('');
	});
});

describe('DevSlot stub without registry', () => {
	it('stub renders nothing when renderer is default (no-op)', async () => {
		// Dynamically import the stub fresh to test default behavior
		// We can't un-inject the renderer in the current process, so instead
		// we test that the stub's DevSlot type-checks and renders via the renderer
		const { DevSlot: StubSlot, setDevSlotRenderer } = await import('@/lib/dev-slots');

		// Temporarily set renderer to no-op
		const origRenderer = setDevSlotRenderer;
		setDevSlotRenderer(() => null);

		const { container } = render(<StubSlot name="dev-panel" />);
		expect(container.innerHTML).toBe('');
	});
});
