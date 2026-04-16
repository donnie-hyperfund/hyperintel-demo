'use client';

import type { ReactNode } from 'react';

// Side-effect imports: inject real implementations into stubs
import './dev-slots';
import './dev-hooks';

// Side-effect: register dev features (hook listeners, slot consumers)
import './features/ws-logger';
import './features/message-feedback';
import './features/message-model-badge';
import './features/message-cost';
import './features/conversation-cost';

import { DevPanel } from './components/dev-panel';

/**
 * Dev tools provider — mounts dev panel and bootstraps all dev features.
 * On prod builds, scripts/strip-dev.sh replaces this with a passthrough stub.
 */
export function DevProvider({ children }: { children: ReactNode }) {
	return (
		<>
			{children}
			<DevPanel />
		</>
	);
}
