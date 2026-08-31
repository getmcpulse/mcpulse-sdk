/** Everything `watch()` accepts, and what it means when you leave it out. */
export interface WatchOptions {
  /** Ingest key, `mp_live_…`. Minted per MCP in the dashboard. */
  key: string;
  /** Where to send. Point this at a local API while developing. */
  endpoint?: string;
  /** Set false to make `watch()` a no-op — useful in tests and CI. */
  enabled?: boolean;
  /** Log what is being sent, and why a send failed, to stderr. */
  debug?: boolean;
}

export interface ResolvedOptions {
  key: string;
  endpoint: string;
  enabled: boolean;
  debug: boolean;
}

/**
 * Where payloads go when `endpoint` is not given.
 *
 * This was the Railway URL for as long as there was no domain to point at, on
 * the grounds that a default which does not resolve is the worst kind: the SDK
 * never throws and drops a batch it cannot send, so a customer would install
 * this, wrap their server, see no error at all, and simply never appear in
 * their dashboard.
 *
 * That reasoning is why the switch to `api.getmcpulse.com` has to be made in
 * the right order. The domain must answer *before* this ships: every server
 * already running holds the old string and keeps working, but the first person
 * to install the new version gets the new one, and if it is not live yet they
 * get the silent failure above rather than an error anybody can see.
 */
export const DEFAULT_ENDPOINT = "https://api.getmcpulse.com";

/** Flush when either is reached, whichever comes first. */
export const FLUSH_AT_ITEMS = 30;
export const FLUSH_EVERY_MS = 5_000;

/**
 * Hard ceiling on the buffer. Reached only when the network is gone; past it
 * the oldest payloads are dropped, because a customer's server running out of
 * memory over our analytics is the one failure we must never cause.
 */
export const MAX_BUFFERED = 1_000;

/** Best-effort window for the final flush on the way out. */
export const EXIT_FLUSH_MS = 1_000;

/**
 * `enabled` defaults to true, but an empty key turns it off: a server started
 * without its key configured should be silent, not a source of 401s on every
 * flush.
 */
export function resolve_options(options: WatchOptions): ResolvedOptions {
  const key = typeof options?.key === "string" ? options.key.trim() : "";

  return {
    key,
    endpoint: (options?.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, ""),
    enabled: (options?.enabled ?? true) && key.length > 0,
    debug: options?.debug ?? false,
  };
}
