import { AsyncLocalStorage } from "node:async_hooks";
import type { Outcome } from "./types.js";

/**
 * Telling the four outcomes apart.
 *
 * This is the whole reason the SDK wraps two layers instead of one.
 *
 * `McpServer`'s `tools/call` handler wraps the entire call in a try/catch and
 * converts anything that escapes into `{ isError: true }`. Seen from outside
 * that handler, a tool that threw, a tool that returned an error, and a call
 * whose arguments never passed validation are all the same object. Three of
 * the sixteen metrics live in that distinction, so reading it back out of an
 * error message would be the only alternative — and error strings are not an
 * interface anyone promised to keep.
 *
 * Instead the author's own callback is wrapped as well, and reports what it
 * did into a slot scoped to the in-flight request:
 *
 *   handler threw            → crashed
 *   handler returned isError → tool_error
 *   handler returned a result→ ok
 *   handler never ran, error → bad_args  (validation rejected the arguments)
 *
 * `AsyncLocalStorage` is what makes the slot per-request rather than per
 * process, so two tools running concurrently cannot claim each other's result.
 */
export interface CallSlot {
  handler_ran: boolean;
  outcome: Outcome | null;
}

const storage = new AsyncLocalStorage<CallSlot>();

export function run_in_slot<T>(slot: CallSlot, fn: () => T): T {
  return storage.run(slot, fn);
}

export function current_slot(): CallSlot | undefined {
  return storage.getStore();
}

/**
 * What the request layer concludes, given what the handler layer reported.
 *
 * `threw` is the request handler itself throwing, which happens on a low-level
 * server (nothing catches for it) and for protocol-level errors that
 * `McpServer` re-raises rather than converts.
 */
export function decide_outcome(slot: CallSlot, result: unknown, threw: boolean): Outcome {
  if (slot.outcome) return slot.outcome;

  if (threw) {
    // Nothing ran the author's code, so this was rejected on the way in.
    return slot.handler_ran ? "crashed" : "bad_args";
  }

  return has_error_flag(result) ? "bad_args" : "ok";
}

/** `isError` is how MCP reports a failure inside an otherwise successful response. */
export function has_error_flag(result: unknown): boolean {
  return (result as { isError?: unknown } | null)?.isError === true;
}
