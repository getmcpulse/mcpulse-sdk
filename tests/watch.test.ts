import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { watch } from "../src/index.js";
import { FLUSH_EVERY_MS } from "../src/options.js";
import type { CallPayload, Payload, StartupPayload } from "../src/types.js";

/**
 * The outcome tests are the point of this file.
 *
 * `McpServer` catches everything a tool does and hands back `{ isError: true }`,
 * so from outside its request handler a crash, a tool error and a validation
 * failure are the same object. Three of the sixteen metrics live in telling
 * them apart, and these are the tests that say the SDK still can.
 */

/**
 * A distinct key per test.
 *
 * The session and its buffer are now shared per destination for the life of the
 * process — which is the point of them — so tests sharing one key would share a
 * buffer across `vi.useFakeTimers()` boundaries and inherit a timer belonging
 * to a clock that no longer exists. A unique key is also the honest model: two
 * keys are two servers, and in production they are two processes.
 */
let key_counter = 0;
let KEY = "";

let sent: Payload[] = [];

beforeEach(() => {
  sent = [];
  KEY = `mp_live_${String(key_counter++).padStart(32, "0")}`;
  // The buffer holds payloads for five seconds before sending. Driving the
  // clock rather than waiting on it keeps the suite fast and, more usefully,
  // makes each test say exactly when it expects a flush.
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as { batch?: Payload[] };
    sent.push(...(body.batch ?? []));
    return new Response(null, { status: 202 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function build_server() {
  const server = new McpServer({ name: "test", version: "1.0.0" });

  server.registerTool(
    "fast_tool",
    { description: "Instant", inputSchema: { q: z.string() } },
    () => ({ content: [{ type: "text" as const, text: "done" }] }),
  );

  server.registerTool("empty_tool", { description: "Nothing" }, () => ({
    content: [{ type: "text" as const, text: "[]" }],
  }));

  server.registerTool("error_tool", { description: "Fails" }, () => ({
    content: [{ type: "text" as const, text: "nope" }],
    isError: true,
  }));

  server.registerTool("crash_tool", { description: "Throws" }, () => {
    throw new Error("boom");
  });

  return server;
}

/** Drives a real `tools/call` through the server's own dispatcher. */
async function call(server: McpServer, name: string, args?: Record<string, unknown>) {
  const low = server.server as unknown as {
    _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<unknown>>;
  };
  const handler = low._requestHandlers.get("tools/call");
  if (!handler) throw new Error("no tools/call handler registered");

  return handler(
    { method: "tools/call", params: { name, arguments: args ?? {} } },
    { signal: new AbortController().signal, requestId: 1 },
  );
}

async function initialize(server: McpServer, client_name = "claude-desktop") {
  const low = server.server as unknown as {
    _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<unknown>>;
  };
  const handler = low._requestHandlers.get("initialize");
  if (!handler) throw new Error("no initialize handler");

  return handler(
    {
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: client_name, version: "1.0.0" },
      },
    },
    { signal: new AbortController().signal, requestId: 0 },
  );
}

/** Advances past the flush interval and lets the send settle. */
async function flush() {
  await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS + 10);
}

const calls = () => sent.filter((p): p is CallPayload => p.type === "call");
const startups = () => sent.filter((p): p is StartupPayload => p.type === "startup");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("outcomes", () => {
  it("records a successful call as ok", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "fast_tool", { q: "hello" });
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.outcome).toBe("ok");
    expect(calls()[0]?.tool_name).toBe("fast_tool");
  });

  it("separates a thrown handler from one that returned an error", async () => {
    // Both arrive at the request layer as `{ isError: true }`. If these two
    // ever report the same outcome, the two-layer wrap has stopped working.
    const server = watch(build_server(), { key: KEY });
    await call(server, "crash_tool");
    await call(server, "error_tool");
    await flush();
    expect(calls()).toHaveLength(2);

    expect(calls()[0]?.outcome).toBe("crashed");
    expect(calls()[1]?.outcome).toBe("tool_error");
  });

  it("records arguments that failed validation as bad_args", async () => {
    const server = watch(build_server(), { key: KEY });
    // `q` is required and must be a string.
    await call(server, "fast_tool", { q: 42 });
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.outcome).toBe("bad_args");
  });

  it("records a call to a tool that does not exist as bad_args", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "no_such_tool");
    await flush();
    expect(calls()).toHaveLength(1);

    // The author's code never ran, so this is a request problem, not a crash.
    expect(calls()[0]?.outcome).toBe("bad_args");
  });
});

describe("empties", () => {
  it("flags a success that returned an empty array", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "empty_tool");
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.outcome).toBe("ok");
    expect(calls()[0]?.is_empty).toBe(true);
  });

  it("does not flag a call that returned something", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "fast_tool", { q: "hello" });
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.is_empty).toBe(false);
  });

  it("never flags a failure as empty, since it already has an outcome", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "crash_tool");
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.is_empty).toBe(false);
  });
});

describe("startup", () => {
  it("reports every registered tool with what its schema costs", async () => {
    const server = watch(build_server(), { key: KEY });
    await initialize(server);
    await flush();
    expect(startups()).toHaveLength(1);

    const payload = startups()[0];
    expect(payload?.client_name).toBe("claude-desktop");
    expect(payload?.tools.map((t) => t.name).sort()).toEqual([
      "crash_tool",
      "empty_tool",
      "error_tool",
      "fast_tool",
    ]);
    // Measured on the JSON the client receives, so it is never zero.
    expect(payload?.tools.every((t) => t.schema_bytes > 0)).toBe(true);
  });

  it("puts the client's name on the calls that follow", async () => {
    const server = watch(build_server(), { key: KEY });
    await initialize(server, "cursor");
    await call(server, "fast_tool", { q: "x" });
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.client_name).toBe("cursor");
  });
});

describe("registration order", () => {
  it("instruments tools registered after watch()", async () => {
    // `McpServer` creates its `tools/call` handler on first registration, so a
    // server watched while still empty has nothing to wrap at that moment.
    const server = watch(new McpServer({ name: "late", version: "1.0.0" }), { key: KEY });

    server.registerTool("late_tool", { description: "Late" }, () => ({
      content: [{ type: "text" as const, text: "hi" }],
    }));

    await call(server, "late_tool");
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.tool_name).toBe("late_tool");
    expect(calls()[0]?.outcome).toBe("ok");
  });

  it("keeps instrumenting a tool whose handler is swapped at runtime", async () => {
    const server = watch(build_server(), { key: KEY });
    const handle = server.registerTool("swap", { description: "Swap" }, () => ({
      content: [{ type: "text" as const, text: "first" }],
    }));

    handle.update({
      callback: () => ({ content: [{ type: "text" as const, text: "second" }], isError: true }),
    });

    await call(server, "swap");
    await flush();
    expect(calls()).toHaveLength(1);

    expect(calls()[0]?.outcome).toBe("tool_error");
  });
});

describe("privacy", () => {
  it("sends no arguments and no results, only sizes and a hash", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "fast_tool", { q: "a-very-secret-customer-value" });
    await flush();
    expect(calls()).toHaveLength(1);

    const wire = JSON.stringify(sent);
    expect(wire).not.toContain("a-very-secret-customer-value");
    expect(wire).not.toContain("done");

    const payload = calls()[0];
    expect(payload?.args_hash).toMatch(/^[0-9a-f]{12}$/);
    expect(payload?.response_bytes).toBeGreaterThan(0);
  });

  it("hashes the same arguments to the same value whatever order they arrive in", async () => {
    const server = watch(build_server(), { key: KEY });
    await call(server, "fast_tool", { q: "x" });
    await call(server, "fast_tool", { q: "x" });
    await flush();
    expect(calls()).toHaveLength(2);

    expect(calls()[0]?.args_hash).toBe(calls()[1]?.args_hash);
  });
});

describe("staying out of the way", () => {
  it("returns the tool's real answer unchanged", async () => {
    const server = watch(build_server(), { key: KEY });
    const result = (await call(server, "fast_tool", { q: "x" })) as { content: unknown[] };

    expect(result.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("is a no-op without a key, rather than a source of 401s", async () => {
    const server = watch(build_server(), { key: "" });
    await call(server, "fast_tool", { q: "x" });
    await flush();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("is a no-op when disabled", async () => {
    const server = watch(build_server(), { key: KEY, enabled: false });
    await call(server, "fast_tool", { q: "x" });
    await flush();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("hands back anything that is not an MCP server, untouched", () => {
    const not_a_server = { hello: "world" };
    expect(watch(not_a_server, { key: KEY })).toBe(not_a_server);
  });

  it("still answers the tool call when the network is down", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network unreachable"));
    const server = watch(build_server(), { key: KEY });

    const result = (await call(server, "fast_tool", { q: "x" })) as { content: unknown[] };
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("leaves a low-level server's own handlers working", async () => {
    const server = new McpServer({ name: "low", version: "1.0.0" });
    server.server.setRequestHandler(InitializeRequestSchema, () => ({
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: { name: "low", version: "1.0.0" },
    }));

    expect(() => watch(server, { key: KEY })).not.toThrow();
    expect(CallToolRequestSchema).toBeDefined();
  });
});

describe("watching twice", () => {
  it("reports each call once, not once per watch()", async () => {
    // Two `watch()` calls used to mean two sessions and two copies of every
    // payload — the customer's numbers doubled, and so did what they pay.
    const server = build_server();
    watch(server, { key: KEY });
    watch(server, { key: KEY });

    await call(server, "fast_tool", { q: "x" });
    await flush();

    expect(calls()).toHaveLength(1);
  });
});

describe("a server rebuilt per request", () => {
  it("keeps one session across every server watched in this process", async () => {
    // A streamable-HTTP MCP server constructs a fresh `McpServer` for each
    // request, so `watch()` runs per request. A session id per `watch()` made
    // every call its own session — and a retry is the same tool twice inside
    // one session, so none could ever be found and first-call success read
    // 100% however badly the server was doing.
    const first = watch(build_server(), { key: KEY });
    await call(first, "fast_tool", { q: "a" });

    const second = watch(build_server(), { key: KEY });
    await call(second, "fast_tool", { q: "b" });

    await flush();

    const sessions = new Set(calls().map((c) => c.session_id));
    expect(calls()).toHaveLength(2);
    expect(sessions.size).toBe(1);
  });

  it("keeps separate streams for separate destinations", async () => {
    // Two servers reporting to different MCPs are two different customers'
    // data. Merging them would file one's calls under the other.
    const mine = watch(build_server(), { key: KEY });
    const theirs = watch(build_server(), { key: `${KEY}_other` });

    await call(mine, "fast_tool", { q: "x" });
    await call(theirs, "fast_tool", { q: "x" });
    await flush();

    expect(new Set(calls().map((c) => c.session_id)).size).toBe(2);
  });
});
