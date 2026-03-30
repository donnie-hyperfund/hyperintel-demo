'use client';

import type { ReactNode } from 'react';

// Side-effect imports: inject real implementations into stubs
import './dev-slots';
import './dev-hooks';

// Side-effect: register dev features (hook listeners, slot consumers)
import './features/ws-logger';
import './features/message-feedback';

import { DevPanel } from './components/dev-panel';

type Props = { children: ReactNode };

/**
 * Single entry point for the dev tools system.
 * In production, renders only children with zero overhead.
 * In development, mounts the dev panel and bootstraps all dev features.
 */
export function DevProvider({ children }: Props) {
	if (process.env.NODE_ENV === 'production') {
		return <>{children}</>;
	}

	return (
		<>
			{children}
			<DevPanel />
		</>
	);
}
