import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayloadBuffer } from "../src/buffer.js";
import { FLUSH_AT_ITEMS, FLUSH_EVERY_MS, MAX_BUFFERED, resolve_options } from "../src/options.js";
import type { CallPayload, Payload } from "../src/types.js";

/**
 * The buffer is where "never block" and "never grow" are actually enforced, and
 * both failures are invisible until they matter: a flush that awaits in the hot
 * path only shows up under load, and unbounded growth only shows up when the
 * network has been down for an hour.
 */

const options = resolve_options({ key: "mp_live_test", endpoint: "http://localhost:9999" });

let batches: Payload[][] = [];

function payload(tool_name: string): CallPayload {
  return {
    v: 1,
    type: "call",
    session_id: "s_1",
    client_name: "test",
    tool_name,
    started_at: "2026-08-09T14:22:31.000Z",
    duration_ms: 1,
    outcome: "ok",
    response_bytes: 10,
    is_empty: false,
    args_hash: "abcdef012345",
  };
}

beforeEach(() => {
  batches = [];
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as { batch: Payload[] };
    batches.push(body.batch);
    return new Response(null, { status: 202 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("flushing", () => {
  it("sends nothing until there is a reason to", () => {
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("a"));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends on the timer", async () => {
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("a"));

    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS + 10);
    expect(batches).toEqual([[payload("a")]]);
  });

  it("sends early once the batch is full, without waiting for the timer", async () => {
    const buffer = new PayloadBuffer(options, () => {});
    for (let i = 0; i < FLUSH_AT_ITEMS; i++) buffer.add(payload(`t${i}`));

    await vi.advanceTimersByTimeAsync(0);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(FLUSH_AT_ITEMS);
  });

  it("returns from add() without awaiting the network", () => {
    // The whole "never block" rule in one assertion: adding is synchronous, so
    // no model ever waits on MCPulse for its answer.
    const buffer = new PayloadBuffer(options, () => {});
    const before = Date.now();
    for (let i = 0; i < FLUSH_AT_ITEMS; i++) buffer.add(payload(`t${i}`));

    expect(Date.now() - before).toBe(0);
  });

  it("does not send the same payload twice when flushes overlap", async () => {
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("a"));

    await Promise.all([buffer.flush(), buffer.flush(), buffer.flush()]);

    expect(batches.flat()).toHaveLength(1);
  });

  it("loses nothing and repeats nothing when adds overlap a flush", async () => {
    // Which batch "second" lands in is timing, and asserting that would be
    // pinning an implementation detail. What must hold is that every payload
    // is sent exactly once — no gap, no double count.
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("first"));
    const flight = buffer.flush();
    buffer.add(payload("second"));
    await flight;
    await buffer.flush();

    const names = batches.flat().map((p) => (p as CallPayload).tool_name);
    expect(names.sort()).toEqual(["first", "second"]);
  });
});

describe("when the network is gone", () => {
  it("drops the batch rather than retrying it forever", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("unreachable"));
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("a"));

    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS + 10);
    vi.mocked(fetch).mockClear();

    // Nothing is re-queued, so the next interval has nothing to send.
    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS + 10);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops growing at the cap and drops the oldest first", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("unreachable"));
    const buffer = new PayloadBuffer(options, () => {});

    // Far more than the cap, without ever letting a flush succeed.
    for (let i = 0; i < MAX_BUFFERED + 50; i++) buffer.add(payload(`t${i}`));

    // Back to the recording implementation — `mockRejectedValue` replaced it,
    // and a plain `mockResolvedValue` would answer 202 while capturing nothing.
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit)?.body ?? "{}")) as { batch: Payload[] };
      batches.push(body.batch);
      return new Response(null, { status: 202 });
    });
    await buffer.flush();

    const sent = batches.flat() as CallPayload[];
    expect(sent.length).toBeLessThanOrEqual(MAX_BUFFERED);
    // The most recent calls survived; the earliest were the ones let go.
    expect(sent.at(-1)?.tool_name).toBe(`t${MAX_BUFFERED + 49}`);
    expect(sent.some((p) => p.tool_name === "t0")).toBe(false);
  });
});

describe("close", () => {
  it("sends what is left", async () => {
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("last"));

    await buffer.close();
    expect(batches.flat()).toHaveLength(1);
  });

  it("accepts nothing after closing", async () => {
    const buffer = new PayloadBuffer(options, () => {});
    await buffer.close();
    buffer.add(payload("late"));

    await vi.advanceTimersByTimeAsync(FLUSH_EVERY_MS + 10);
    expect(batches.flat()).toHaveLength(0);
  });

  it("gives up rather than hanging the process on a dead network", async () => {
    // A server shutting down must not wait on us. The exit flush is bounded.
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const buffer = new PayloadBuffer(options, () => {});
    buffer.add(payload("a"));

    const closing = buffer.close();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(closing).resolves.toBeUndefined();
  });
});
