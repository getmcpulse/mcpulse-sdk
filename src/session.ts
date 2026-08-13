import { PayloadBuffer } from "./buffer.js";
import { register_exit_flush } from "./exit.js";
import { new_session_id } from "./hash.js";
import type { ResolvedOptions } from "./options.js";

/**
 * One session and one buffer per destination, for the life of the process.
 *
 * The first version made both inside `watch()`, which is right for a stdio
 * server — one process, one `watch()`, one session — and wrong for an HTTP one.
 * A streamable-HTTP server builds a fresh `McpServer` per request, so `watch()`
 * runs per request too, and every tool call became a session of its own.
 *
 * That is not a cosmetic difference. Retries are found by looking for the same
 * tool twice inside one session, and first-call success is defined as no retry
 * following. With one call per session there can never be a retry, so the
 * server reports a perfect score however badly it is doing — the one number
 * this product exists to tell the truth about.
 *
 * Keyed by endpoint and key rather than a bare singleton: two watched servers
 * reporting to different MCPs in one process are two different streams, and
 * merging them would file one customer's calls under another's.
 */

interface Stream {
  session_id: string;
  buffer: PayloadBuffer;
}

const streams = new Map<string, Stream>();

export function stream_for(
  options: ResolvedOptions,
  log: (message: string, detail?: unknown) => void,
): Stream {
  const key = `${options.endpoint}|${options.key}`;

  let stream = streams.get(key);
  if (!stream) {
    stream = { session_id: new_session_id(), buffer: new PayloadBuffer(options, log) };
    streams.set(key, stream);
    register_exit_flush(stream.buffer);
  }

  return stream;
}
