/**
 * Adaptive rAF-based drip queue with TPS tracking.
 *
 * Tracks average tokens-per-second over a sliding window (default 5s) and
 * drips items at that rate — producing smooth, steady output regardless of
 * how bursty the backend delivery is.
 *
 * Fallback behaviour:
 *  - Cold start (no TPS data yet): proportional drain (35% of queue/frame)
 *  - Queue growing past soft cap: proportional boost on top of TPS rate
 *  - Queue over hard cap: force-drain excess immediately
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
 * threshold. Keeps TPS tracking accurate and prevents dumping a whole
 * sentence in one drip frame. Short deltas pass through untouched.
 */
const CHUNK_THRESHOLD = 8;
export function chunkText(text: string): string[] {
	if (text.length <= CHUNK_THRESHOLD) return [text];
	const chunks: string[] = [];
	const re = /\S+\s*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) chunks.push(m[0]);
	return chunks.length > 0 ? chunks : [text];
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
			/** Hard queue cap — force-drains excess (default 60). */
			maxQueue?: number;
			/** Queue depth above which proportional boost kicks in (default 15). */
			softCap?: number;
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
		const cutoff = now - windowMs;

		// Prune old entries
		while (this.arrivals.length > 0 && this.arrivals[0].time < cutoff) {
			this.arrivals.shift();
		}

		if (this.arrivals.length < 2) return 0;

		const total = this.arrivals.reduce((sum, a) => sum + a.count, 0);
		const elapsed = now - this.arrivals[0].time;
		if (elapsed < 100) return 0; // too little time to estimate

		return (total / elapsed) * 1000;
	}

	private tick = () => {
		const q = this.queue;
		if (q.length === 0) {
			this.rafId = 0;
			return;
		}

		const maxQ = this.opts.maxQueue ?? 60;
		const softCap = this.opts.softCap ?? 15;

		let count: number;

		if (q.length > maxQ) {
			// Hard cap — force-drain excess to prevent runaway lag
			count = q.length - Math.floor(maxQ / 2);
			this.budget = 0;
		} else {
			const tps = this.computeTPS();

			if (tps > 0) {
				// TPS-adaptive: drip at the measured average rate
				this.budget += tps / 60; // items per frame at 60fps
				count = Math.floor(this.budget);
				this.budget -= count;

				// If queue growing beyond soft cap, proportionally boost
				if (q.length > softCap) {
					count += Math.ceil((q.length - softCap) * 0.3);
				}
			} else {
				// Cold start — proportional fallback
				count = Math.max(1, Math.ceil(q.length * 0.35));
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

	/** Cancel animation, discard queue, and reset TPS tracking (for unmount / topic change). */
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
