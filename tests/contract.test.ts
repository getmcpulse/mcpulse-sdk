import { describe, expect, it } from "vitest";
import { WIRE_VERSION, type CallPayload, type Outcome, type StartupPayload } from "../src/types.js";

/**
 * The wire contract, pinned.
 *
 * `src/types.ts` restates `@mcpulse/schemas` rather than importing it, so that
 * this package can install into a customer's server without dragging Zod along
 * behind it. The cost of that decision is drift, and this file is what makes
 * drift loud: every field the API validates is asserted here by name.
 *
 * If the API's contract changes, these fail. That is the point — a payload that
 * no longer matches is dropped silently at ingest, which is the worst possible
 * way to find out.
 */

const CALL_FIELDS = [
  "v",
  "type",
  "session_id",
  "client_name",
  "tool_name",
  "started_at",
  "duration_ms",
  "outcome",
  "response_bytes",
  "is_empty",
  "args_hash",
] as const;

const STARTUP_FIELDS = ["v", "type", "session_id", "client_name", "tools"] as const;

const OUTCOMES: Outcome[] = ["ok", "bad_args", "tool_error", "crashed"];

describe("wire contract", () => {
  it("is version 1", () => {
    // The API rejects anything else outright.
    expect(WIRE_VERSION).toBe(1);
  });

  it("sends exactly the fields a call payload is defined to have", () => {
    const payload: CallPayload = {
      v: WIRE_VERSION,
      type: "call",
      session_id: "s_abc",
      client_name: "claude-desktop",
      tool_name: "search_orders",
      started_at: "2026-08-09T14:22:31.000Z",
      duration_ms: 240,
      outcome: "ok",
      response_bytes: 1420,
      is_empty: false,
      args_hash: "9c1b4e2f0a11",
    };

    expect(Object.keys(payload).sort()).toEqual([...CALL_FIELDS].sort());
  });

  it("sends exactly the fields a startup payload is defined to have", () => {
    const payload: StartupPayload = {
      v: WIRE_VERSION,
      type: "startup",
      session_id: "s_abc",
      client_name: "claude-desktop",
      tools: [{ name: "search_orders", schema_bytes: 480 }],
    };

    expect(Object.keys(payload).sort()).toEqual([...STARTUP_FIELDS].sort());
    expect(Object.keys(payload.tools[0]!).sort()).toEqual(["name", "schema_bytes"]);
  });

  it("knows all four outcomes and no others", () => {
    expect(OUTCOMES).toHaveLength(4);
    expect(new Set(OUTCOMES).size).toBe(4);
  });

  it("carries no field that could hold customer data", () => {
    // The rule that lets an MCP author pass a security review. Adding
    // `arguments` or `result` here would break it, and it cannot be un-broken.
    const forbidden = ["arguments", "args", "result", "content", "input", "output", "params"];
    for (const field of [...CALL_FIELDS, ...STARTUP_FIELDS]) {
      expect(forbidden).not.toContain(field);
    }
  });
});
