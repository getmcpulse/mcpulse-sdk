import type { PayloadBuffer } from "./buffer.js";

/**
 * One last flush on the way out, so the final few calls of a session are not
 * lost to a five-second timer that never fired.
 *
 * The process listeners are registered once for the whole package, however many
 * servers are being watched. Registering per server is what it looked like at
 * first, and it earns Node's "possible EventEmitter memory leak" warning as
 * soon as anything creates more than three — a test suite, or a host running
 * several MCP servers in one process. Printing a memory-leak warning into
 * somebody's logs is precisely the kind of noise this package must not make.
 */

const buffers = new Set<PayloadBuffer>();
let registered = false;

export function register_exit_flush(buffer: PayloadBuffer): void {
  buffers.add(buffer);
  if (registered) return;
  if (typeof process?.once !== "function") return;

  registered = true;

  process.once("beforeExit", () => {
    void flush_all();
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void flush_all().finally(() => {
        // Hand the signal back so the process ends the way it would have. If
        // the customer installed their own handler, theirs runs and ours is
        // done; if nobody else is listening, re-raising reaches the default
        // behaviour instead of leaving the server hanging.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }
}

/** Exposed for tests; production reaches it through the listeners above. */
export async function flush_all(): Promise<void> {
  const pending = [...buffers];
  buffers.clear();
  await Promise.all(pending.map((buffer) => buffer.close()));
}
