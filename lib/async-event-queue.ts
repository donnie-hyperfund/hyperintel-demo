/**
 * A queue that processes events sequentially with async support.
 * Events are processed one at a time in FIFO order, allowing async
 * operations without blocking the caller.
 */
export class AsyncEventQueue<T> {
    private queue: T[] = [];
    private isProcessing = false;
    private handler: (event: T) => Promise<void>;

    constructor(handler: (event: T) => Promise<void>) {
        this.handler = handler;
    }

    /**
     * Add an event to the queue and trigger processing.
     * Returns immediately - processing happens asynchronously.
     */
    push(event: T): void {
        this.queue.push(event);
        void this.process();
    }

    /**
     * Process events from the queue sequentially.
     * Only one instance of this runs at a time.
     *
     * A throwing handler must never brick the queue: a single bad event is
     * logged and skipped, and `isProcessing` is always reset so later pushes
     * keep draining.
     */
    private async process(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const event = this.queue.shift()!;
                try {
                    await this.handler(event);
                } catch (err) {
                    console.error('[AsyncEventQueue] handler threw, skipping event', err);
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }
}
