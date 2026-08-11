import type { LowLevelServer, RequestHandler } from "./server-shapes.js";

/**
 * Replacing handlers on a live server, without changing what it does.
 *
 * Everything here is idempotent. `watch()` re-applies its wrapping every time
 * the server registers a handler, so these are called far more often than they
 * do anything, and wrapping a wrapper would nest a layer deeper each time.
 */

/** Functions this package has already replaced. */
const instrumented = new WeakSet<object>();

/**
 * Swaps a registered handler for one that wraps it.
 *
 * The swap happens inside the dispatcher's own map rather than through
 * `setRequestHandler`, which refuses any method the server has not announced a
 * capability for — and announcing capabilities on the customer's behalf would
 * change what their server tells clients it can do.
 */
export function wrap_handler(
  low: LowLevelServer,
  method: string,
  make: (original: RequestHandler) => RequestHandler,
): void {
  const handlers = low._requestHandlers;
  const original = handlers?.get(method);
  if (!handlers || typeof original !== "function") return;
  if (instrumented.has(original)) return;

  const wrapper = make(original);
  instrumented.add(wrapper);
  handlers.set(method, wrapper);
}

/**
 * Runs `after` whenever the server registers a handler.
 *
 * This is what covers `watch()` being called before any tool exists:
 * `McpServer` does not create its `tools/call` handler until the first
 * registration, so a server watched while still empty has nothing to wrap at
 * that moment.
 *
 * The schema argument is deliberately not inspected. Reading a method name back
 * out of a Zod schema is more fragile than re-checking the map, which is cheap
 * and already idempotent.
 */
export function patch_set_request_handler(low: LowLevelServer, after: () => void): void {
  const original = low.setRequestHandler;
  if (typeof original !== "function") return;
  if (instrumented.has(original)) return;

  const patched = function (this: unknown, schema: unknown, handler: RequestHandler) {
    (original as (s: unknown, h: RequestHandler) => void).call(this ?? low, schema, handler);
    try {
      after();
    } catch {
      /* A server registering a handler must not fail because we watched it. */
    }
  };

  instrumented.add(patched);
  low.setRequestHandler = patched;
}
