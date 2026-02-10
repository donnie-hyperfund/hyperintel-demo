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
     */
    private async process(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const event = this.queue.shift()!;
            await this.handler(event);
        }

        this.isProcessing = false;
    }
}
