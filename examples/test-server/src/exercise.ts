import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { watch } from "@mcpulse/sdk";
import { build_test_server } from "./tools.js";

/**
 * Drives every recorded behaviour once, end to end, and waits for the send.
 *
 * ```
 * MCPULSE_KEY=mp_live_… MCPULSE_ENDPOINT=http://localhost:3000 pnpm exercise
 * ```
 *
 * A real `Client` over a linked in-memory transport, rather than the handlers
 * being poked directly: that way the actual `initialize` handshake runs, which
 * is what produces the startup payload and the client name. Poking handlers
 * would test the SDK against a shape this file invented.
 */

const server = watch(build_test_server(), {
  key: process.env.MCPULSE_KEY ?? "",
  endpoint: process.env.MCPULSE_ENDPOINT,
  debug: true,
});

const client = new Client({ name: "mcpulse-exercise", version: "1.0.0" });
const [client_side, server_side] = InMemoryTransport.createLinkedPair();

await Promise.all([server.connect(server_side), client.connect(client_side)]);

/** Each call is expected to fail in its own way, so none of them are errors here. */
async function attempt(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const result = (await run()) as { isError?: boolean };
    console.log(`  ${label}: ${result?.isError ? "isError: true" : "ok"}`);
  } catch (error) {
    console.log(`  ${label}: threw — ${error instanceof Error ? error.message : String(error)}`);
  }
}

const call = (name: string, args: Record<string, unknown> = { query: "orders" }) =>
  client.callTool({ name, arguments: args });

console.log("exercising:");

await attempt("fast_tool   → ok", () => call("fast_tool"));
await attempt("empty_tool  → ok + is_empty", () => call("empty_tool"));
await attempt("error_tool  → tool_error", () => call("error_tool"));
await attempt("crash_tool  → crashed", () => call("crash_tool"));
await attempt("fast_tool   → bad_args", () => call("fast_tool", { query: 42 }));
await attempt("slow_tool   → ok, over 2s", () => call("slow_tool"));

// `dead_tool` is deliberately never called — it is the one that should show up
// as costing schema bytes while returning nothing to anyone.

// Retry detection needs the same tool twice inside 30 seconds with different
// arguments: the model rewording its request rather than paging through it.
await attempt("fast_tool   → retry (reworded)", () => call("fast_tool", { query: "recent orders" }));

console.log("\nflushing…");
await client.close();
await server.close();

// The buffer flushes on exit, but this script is short enough that waiting
// makes the result observable rather than hoping the process lingers.
await new Promise((resolve) => setTimeout(resolve, 6_000));
console.log("done — check the dashboard");
process.exit(0);
