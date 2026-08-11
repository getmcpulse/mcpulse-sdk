import type { ResolvedOptions } from "./options.js";
import type { Payload } from "./types.js";

/**
 * Post one batch. Resolves either way — a caller must never have to catch.
 *
 * A failed batch is dropped, deliberately. Retrying means either a queue that
 * grows while the network is down, or duplicate rows when a 202 is lost on the
 * way back. Neither is worth it for analytics: the next flush is five seconds
 * away, and a gap in a chart is a far smaller problem than memory growth
 * inside someone else's server.
 */
export async function post_batch(
  payloads: Payload[],
  options: ResolvedOptions,
  timeout_ms: number,
): Promise<boolean> {
  if (payloads.length === 0) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout_ms);

  try {
    const response = await fetch(`${options.endpoint}/v1/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.key}`,
      },
      body: JSON.stringify({ batch: payloads }),
      signal: controller.signal,
      // Asks the runtime to let the request outlive the page/process teardown.
      // Node ignores it; it is what makes the exit flush work in edge runtimes.
      keepalive: true,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
