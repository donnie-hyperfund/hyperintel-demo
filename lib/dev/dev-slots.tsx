'use client';

import { type ComponentType, type ReactNode, useSyncExternalStore } from 'react';
import { type DevSlotName, type DevSlotProps, setDevSlotRenderer } from '@/lib/dev-slots';

type SlotComponent<N extends DevSlotName> = ComponentType<DevSlotProps[N]>;

type Listener = () => void;

/** Internal mutable store — one Set of components per slot name. */
const registry = new Map<DevSlotName, Set<SlotComponent<any>>>();
const listeners = new Set<Listener>();

let snapshot = 0;

function notify() {
	snapshot++;
	for (const fn of listeners) fn();
}

function getSnapshot() {
	return snapshot;
}

function subscribe(cb: Listener) {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

function getSlotComponents<N extends DevSlotName>(name: N): SlotComponent<N>[] {
	const set = registry.get(name);
	return set ? ([...set] as SlotComponent<N>[]) : [];
}

/**
 * Register a component into a named dev slot.
 * Returns an unregister cleanup function (handy for useEffect).
 */
function register<N extends DevSlotName>(name: N, component: SlotComponent<N>): () => void {
	let set = registry.get(name);
	if (!set) {
		set = new Set();
		registry.set(name, set);
	}
	set.add(component as SlotComponent<any>);
	notify();

	return () => unregister(name, component);
}

/** Remove a component from a named dev slot. */
function unregister<N extends DevSlotName>(name: N, component: SlotComponent<N>): void {
	const set = registry.get(name);
	if (!set) return;
	set.delete(component as SlotComponent<any>);
	if (set.size === 0) registry.delete(name);
	notify();
}

export const devSlots = { register, unregister } as const;

/** The real DevSlot renderer — renders all registered components for a slot. */
function RealDevSlot({ name, ...props }: { name: DevSlotName } & Record<string, unknown>): ReactNode {
	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const components = getSlotComponents(name);
	if (components.length === 0) return null;

	return (
		<>
			{components.map((Comp, i) => (
				<Comp key={i} {...(props as any)} />
			))}
		</>
	);
}

// Inject the real renderer into the stub at module load
setDevSlotRenderer(RealDevSlot);
