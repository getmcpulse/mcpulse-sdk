/**
 * The MCPulse wire format, as this package builds it.
 *
 * These mirror `@mcpulse/schemas`, which is the contract the API validates
 * against. They are restated here rather than imported for one reason: this
 * package installs into other people's servers, and the schemas package brings
 * Zod with it. Nothing here needs Zod — the SDK writes payloads, the API is
 * what validates them, and dropping a validation library into every customer's
 * process to check our own output would be a cost with no buyer.
 *
 * The price of that is drift, which `tests/contract.test.ts` is there to catch:
 * it pins every field name, the wire version and the outcome list, so a change
 * in the API's contract fails here rather than silently at ingest.
 */

/** Bump only for a breaking change; the API rejects anything else. */
export const WIRE_VERSION = 1;

/**
 * How a tool call ended. Exactly one of these, always.
 *
 * - `ok`         ran and returned a result
 * - `bad_args`   arguments failed schema validation, the handler never ran
 * - `tool_error` ran and returned `isError: true`
 * - `crashed`    threw
 */
export type Outcome = "ok" | "bad_args" | "tool_error" | "crashed";

/** Sent once, when the customer's server boots. */
export interface StartupPayload {
  v: typeof WIRE_VERSION;
  type: "startup";
  session_id: string;
  client_name: string;
  tools: Array<{
    name: string;
    /** What this tool costs the context window, every session, called or not. */
    schema_bytes: number;
  }>;
}

/** Sent every time a tool runs. */
export interface CallPayload {
  v: typeof WIRE_VERSION;
  type: "call";
  session_id: string;
  client_name: string;
  tool_name: string;
  /** ISO 8601 with an offset. */
  started_at: string;
  duration_ms: number;
  outcome: Outcome;
  response_bytes: number;
  is_empty: boolean;
  /**
   * First 12 lowercase hex characters of the SHA-256 of the RFC 8785 canonical
   * form of the arguments. Never reversible, and identical across every
   * MCPulse SDK — `tests/fixtures/canonical.json` is what holds them to that.
   * `000000000000` means the arguments were not representable as JSON.
   */
  args_hash: string;
}

export type Payload = StartupPayload | CallPayload;
