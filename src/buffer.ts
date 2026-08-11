import {
  EXIT_FLUSH_MS,
  FLUSH_AT_ITEMS,
  FLUSH_EVERY_MS,
  MAX_BUFFERED,
  type ResolvedOptions,
} from "./options.js";
import { post_batch } from "./transport.js";
import type { Payload } from "./types.js";

/**
 * Holds payloads and sends them in batches.
 *
 * The contract with the tool call that produced a payload is that `add` returns
 * immediately and never throws. Everything expensive happens on a timer or on
 * a promise nobody awaits, so no model ever waits on MCPulse to answer.
 */
export class PayloadBuffer {
  private readonly pending: Payload[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private in_flight: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly options: ResolvedOptions,
    private readonly log: (message: string, detail?: unknown) => void,
  ) {}

  add(payload: Payload): void {
    if (this.closed) return;

    if (this.pending.length >= MAX_BUFFERED) {
      // Oldest first: recent calls describe what the server is doing now, and
      // that is the more useful half of a buffer that could not be sent.
      this.pending.shift();
      this.log("buffer full, dropped oldest payload");
    }

    this.pending.push(payload);

    if (this.pending.length >= FLUSH_AT_ITEMS) {
      void this.flush();
      return;
    }

    this.start_timer();
  }

  /**
   * Sends everything buffered. Safe to call at any time and from anywhere —
   * concurrent callers queue behind each other rather than racing for the same
   * payloads, which is what would otherwise send a batch twice.
   */
  flush(timeout_ms = 10_000): Promise<void> {
    this.stop_timer();

    this.in_flight = this.in_flight.then(async () => {
      // Taken in one go: anything added while this is in flight belongs to the
      // next batch, not this one.
      const batch = this.pending.splice(0, this.pending.length);
      if (batch.length === 0) return;

      const sent = await post_batch(batch, this.options, timeout_ms);
      this.log(sent ? `sent ${batch.length} payloads` : `dropped ${batch.length} payloads`);
    });

    return this.in_flight;
  }

  /** Final flush, best effort. After this the buffer accepts nothing more. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stop_timer();

    await Promise.race([
      this.flush(EXIT_FLUSH_MS),
      new Promise<void>((resolve) => setTimeout(resolve, EXIT_FLUSH_MS)),
    ]);
  }

  private start_timer(): void {
    if (this.timer) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_EVERY_MS);

    // Without this the customer's server would not exit while a flush is
    // pending — MCPulse would be holding their process open.
    this.timer.unref?.();
  }

  private stop_timer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
