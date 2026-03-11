/**
 * rAF-based drip queue for smooth streaming output.
 *
 * Tokens arrive from WebSocket in bursts. Without smoothing, the UI shows
 * [fast dump] → [pause] → [fast dump]. This queue absorbs bursts and drips
 * items at a steady 1-per-frame rate (~60/sec), producing a smooth typewriter
 * effect regardless of backend delivery timing.
 *
 * When the queue grows deep (fast model or slow consumer), the drip rate
 * ramps up proportionally to prevent falling behind. A hard cap force-drains
 * excess to bound latency.
 *
 * @example
 * ```ts
 * const drip = new TokenDrip<string>(
 *   (token) => { buffer += token; },
 *   () => { setState(buffer); },
 * );
 * ws.onmessage = (e) => drip.enqueue(e.data);
 * // on unmount:
 * drip.dispose();
 * ```
 */

/**
 * Split a text delta into word-boundary chunks when it exceeds a character
 * threshold. Prevents dumping a whole sentence in one drip frame.
 * Short deltas pass through untouched.
 */
const CHUNK_THRESHOLD = 8;
export function chunkText(text: string): string[] {
	if (text.length <= CHUNK_THRESHOLD) return [text];
	// Split at word boundaries (whitespace→non-whitespace transitions).
	// Zero-width split — no characters consumed, nothing can be dropped.
	// Unicode-aware flag so \s and \S handle surrogate pairs correctly.
	const chunks = text.split(/(?<=\s)(?=\S)/u);
	return chunks.length > 1 ? chunks : [text];
}

export class TokenDrip<T> {
	private queue: T[] = [];
	private rafId = 0;

	// TPS tracking — sliding window of arrival batches
	private arrivals: { time: number; count: number }[] = [];
	private budget = 0;

	constructor(
		/** Apply a single item to your mutable state (NO React setState here). */
		private apply: (item: T) => void,
		/** Flush applied changes to React state (called once per rAF frame, only when items were drained). */
		private onFlush: () => void,
		private opts: {
			/** Sliding window for TPS calculation in ms (default 5000). */
			tpsWindow?: number;
			/** Hard queue cap — force-drains excess (default 80). */
			maxQueue?: number;
			/** Minimum elapsed time before trusting TPS (default 1000ms). */
			tpsMinElapsed?: number;
		} = {},
	) {}

	/** Add one or more items to the drip queue. */
	enqueue(item: T): void;
	enqueue(items: T[]): void;
	enqueue(itemOrItems: T | T[]): void {
		const count = Array.isArray(itemOrItems) ? itemOrItems.length : 1;
		if (Array.isArray(itemOrItems)) {
			for (let i = 0; i < itemOrItems.length; i++) this.queue.push(itemOrItems[i]);
		} else {
			this.queue.push(itemOrItems);
		}

		// Record arrival for TPS tracking (coalesce within 2ms)
		const now = performance.now();
		const last = this.arrivals[this.arrivals.length - 1];
		if (last && now - last.time < 2) {
			last.count += count;
		} else {
			this.arrivals.push({ time: now, count });
		}

		if (!this.rafId) this.rafId = requestAnimationFrame(this.tick);
	}

	/** Compute average items/second over the sliding window. Returns 0 if insufficient data. */
	private computeTPS(): number {
		const now = performance.now();
		const windowMs = this.opts.tpsWindow ?? 5000;
		const minElapsed = this.opts.tpsMinElapsed ?? 1000;
		const cutoff = now - windowMs;

		// Prune old entries
		while (this.arrivals.length > 0 && this.arrivals[0].time < cutoff) {
			this.arrivals.shift();
		}

		if (this.arrivals.length < 2) return 0;

		const total = this.arrivals.reduce((sum, a) => sum + a.count, 0);
		const elapsed = now - this.arrivals[0].time;
		// Don't trust TPS until we have enough data to average out bursts
		if (elapsed < minElapsed) return 0;

		return (total / elapsed) * 1000;
	}

	private tick = () => {
		const q = this.queue;
		if (q.length === 0) {
			this.rafId = 0;
			return;
		}

		const maxQ = this.opts.maxQueue ?? 80;

		let count: number;

		const softCap = Math.floor(maxQ / 2);

		if (q.length > maxQ) {
			// Hard cap — force-drain excess to bound latency
			count = q.length - softCap;
			this.budget = 0;
		} else {
			const tps = this.computeTPS();

			if (tps > 0) {
				// TPS-adaptive: drip at the measured average rate
				this.budget += tps / 60; // items per frame at 60fps
				count = Math.floor(this.budget);
				this.budget -= count;
			} else {
				// Cold start (< 1s of data) — drip 1 item/frame
				count = 1;
			}

			// Soft cap: scale up drain as queue grows to prevent overflow.
			// Ensures queue can never silently creep to hard cap, even during
			// cold start or if TPS underestimates a fast model.
			if (q.length > softCap) {
				const excess = q.length - softCap;
				const boost = 1 + Math.floor(excess / 10);
				count = Math.max(count, 1 + boost);
			}
		}

		if (count > 0) {
			const n = Math.min(count, q.length);
			for (let i = 0; i < n; i++) this.apply(q.shift()!);
			this.onFlush();
		}

		if (q.length > 0) {
			this.rafId = requestAnimationFrame(this.tick);
		} else {
			this.rafId = 0;
		}
	};

	/** Immediately drain all queued items (call before terminal state changes). */
	drain(): void {
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = 0;
		}
		while (this.queue.length > 0) this.apply(this.queue.shift()!);
	}

	/** Number of items still queued. */
	get pending(): number {
		return this.queue.length;
	}

	/** Cancel animation, discard queue, and reset state (for unmount / topic change). */
	dispose(): void {
		if (this.rafId) {
			cancelAnimationFrame(this.rafId);
			this.rafId = 0;
		}
		this.queue.length = 0;
		this.arrivals.length = 0;
		this.budget = 0;
	}
}
