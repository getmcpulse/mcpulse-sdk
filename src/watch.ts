import type { PayloadBuffer } from "./buffer.js";
import { is_empty_result } from "./empty.js";
import { args_hash } from "./hash.js";
import { make_logger } from "./logger.js";
import { resolve_options, type WatchOptions } from "./options.js";
import { decide_outcome, run_in_slot, type CallSlot } from "./outcome.js";
import {
  INITIALIZE,
  TOOLS_CALL,
  low_level_server,
  type AnyServer,
  type LowLevelServer,
  type McpRequest,
  type RequestHandler,
} from "./server-shapes.js";
import { patch_set_request_handler, wrap_handler } from "./patch.js";
import { collect_tools, patch_registration, wrap_registered_tools } from "./tools.js";
import { WIRE_VERSION } from "./types.js";
import { stream_for } from "./session.js";

/** Servers already being watched, so a second `watch()` is a no-op. */
const watched = new WeakSet<object>();

/**
 * Start recording what this MCP server does.
 *
 * ```ts
 * const server = watch(myServer, { key: "mp_live_…" });
 * ```
 *
 * The server is instrumented in place and handed straight back, so the call can
 * be dropped around an existing one without moving anything else.
 *
 * Nothing here is allowed to break the server it is measuring. Every path is
 * wrapped: if instrumentation cannot be attached, the original server is
 * returned untouched and the process carries on without analytics, because a
 * customer's tool failing over our telemetry is worse than no telemetry.
 */
export function watch<T>(server: T, options: WatchOptions): T {
  try {
    const resolved = resolve_options(options);
    const log = make_logger(resolved.debug);

    // Watching twice is a mistake, not a request for two of everything. Left
    // unguarded it would open a second session and report every call under both
    // — doubling the customer's numbers and their bill.
    if (server && typeof server === "object") {
      if (watched.has(server)) {
        log("already watching this server");
        return server;
      }
      watched.add(server);
    }

    if (!resolved.enabled) {
      log("disabled — no key, or enabled: false");
      return server;
    }

    const low = low_level_server(server as AnyServer);
    if (!low?._requestHandlers) {
      log("not an MCP server, or one this version does not recognise — left alone");
      return server;
    }

    attach(server as AnyServer, low, resolved, log);
    log("watching");
  } catch (error) {
    // Deliberately silent. `watch()` failing must look like `watch()` was never
    // called, and there is no logger to complain to if the options were the
    // thing that was malformed.
    void error;
  }

  return server;
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

type Log = ReturnType<typeof make_logger>;

function attach(
  server: AnyServer,
  low: LowLevelServer,
  options: ReturnType<typeof resolve_options>,
  log: Log,
): void {
  // Shared across every `watch()` in this process that reports to the same
  // place. An HTTP server builds a new `McpServer` per request; without this,
  // each request would open a session of its own and no retry could ever be
  // detected. See `session.ts`.
  const { session_id, buffer } = stream_for(options, log);
  let client_name = "unknown";

  wrap_registered_tools(server);
  patch_registration(server);

  wrap_handler(low, INITIALIZE, (original) => async (request, extra) => {
    const result = await original(request, extra);

    // Read from the request rather than `getClientVersion()`: the client's name
    // is right here, and the getter is only populated once initialisation has
    // finished settling.
    const name = request?.params?.clientInfo?.name;
    if (typeof name === "string" && name.length > 0) client_name = name.slice(0, 128);

    void send_startup(low, buffer, session_id, client_name, log);
    return result;
  });

  const wrap_calls = () =>
    wrap_handler(low, TOOLS_CALL, (original) => (request, extra) => {
      const slot: CallSlot = { handler_ran: false, outcome: null };
      return run_in_slot(slot, () =>
        record_call(original, request, extra, slot, buffer, session_id, () => client_name),
      );
    });

  wrap_calls();

  // `McpServer` does not create its `tools/call` handler until the first tool is
  // registered, so calling `watch()` on a server with no tools yet would find
  // nothing to wrap. Re-applying after each registration covers both orders.
  patch_set_request_handler(low, wrap_calls);
}

/**
 * Times one tool call and buffers the result.
 *
 * Written so the payload is built in a `finally`: whatever the handler does —
 * returns, throws, or is cancelled — the call is recorded once and the original
 * outcome reaches the client unchanged.
 */
async function record_call(
  original: RequestHandler,
  request: McpRequest,
  extra: unknown,
  slot: CallSlot,
  buffer: PayloadBuffer,
  session_id: string,
  client_name: () => string,
): Promise<unknown> {
  const started_at = new Date().toISOString();
  const started = Date.now();

  let result: unknown;
  let threw = false;

  try {
    result = await original(request, extra);
    return result;
  } catch (error) {
    threw = true;
    throw error;
  } finally {
    try {
      const outcome = decide_outcome(slot, result, threw);

      buffer.add({
        v: WIRE_VERSION,
        type: "call",
        session_id,
        client_name: client_name(),
        tool_name: String(request?.params?.name ?? "unknown").slice(0, 200),
        started_at,
        duration_ms: Math.max(0, Date.now() - started),
        outcome,
        response_bytes: byte_length(result),
        // An error is not also an absence — it has its own outcome already.
        is_empty: outcome === "ok" && is_empty_result(result),
        args_hash: args_hash(request?.params?.arguments),
      });
    } catch {
      /* Recording must never be the reason a tool call fails. */
    }
  }
}

async function send_startup(
  low: LowLevelServer,
  buffer: PayloadBuffer,
  session_id: string,
  client_name: string,
  log: Log,
): Promise<void> {
  try {
    const tools = await collect_tools(low);
    buffer.add({
      v: WIRE_VERSION,
      type: "startup",
      session_id,
      client_name,
      tools: tools.slice(0, 500),
    });
    log(`startup: ${tools.length} tools, client ${client_name}`);
  } catch (error) {
    log("could not read the tool list", error);
  }
}

/** What this response costs the context window. Unserialisable means unmeasurable. */
function byte_length(result: unknown): number {
  try {
    return JSON.stringify(result)?.length ?? 0;
  } catch {
    return 0;
  }
}
