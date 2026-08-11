# @mcpulse/sdk

Analytics for MCP servers. Tells you whether your tools actually work for the
models calling them.

You publish an MCP server and can see nothing: not how many people use it, not
which tools get called, not whether the model understands your descriptions, not
what your server costs the people running it. This package is how that data
gets out.

## Install

```bash
npm install @mcpulse/sdk
```

## Use

```ts
import { watch } from "@mcpulse/sdk";

const server = watch(myServer, { key: "mp_live_…" });
```

One import, one wrap. Your server is instrumented in place and handed straight
back, so this drops around an existing one without moving anything else.

Get a key by creating an MCP at [mcpulse.dev](https://mcpulse.dev) — it is shown
once, at creation.

### Options

| Option | Default | |
|---|---|---|
| `key` | — | Ingest key, `mp_live_…`. Without one the SDK does nothing. |
| `endpoint` | `https://api.mcpulse.dev` | Point at a local API while developing. |
| `enabled` | `true` | Set false to turn it off without removing the call. |
| `debug` | `false` | Log what is sent, to **stderr** — never stdout, which is the transport. |

```ts
watch(server, {
  key: process.env.MCPULSE_KEY ?? "",
  endpoint: process.env.MCPULSE_ENDPOINT,
  debug: true,
});
```

## What leaves your process

Per tool call:

```json
{
  "v": 1,
  "type": "call",
  "session_id": "s_7f2a91",
  "tool_name": "search_orders",
  "client_name": "claude-desktop",
  "started_at": "2026-08-09T14:22:31Z",
  "duration_ms": 240,
  "outcome": "ok",
  "response_bytes": 1420,
  "is_empty": false,
  "args_hash": "9c1b4e2f0a11"
}
```

And once at startup, the tool list with the byte size of each schema.

**Never the arguments. Never the results.** `args_hash` is twelve hex characters
of a SHA-256 over the arguments with keys sorted — enough to tell whether two
calls used the same arguments, and not enough for anything else. There is no
option that turns this off, because the guarantee is only worth something if it
cannot be switched off.

### Outcomes

Every call ends as exactly one of these:

| | |
|---|---|
| `ok` | Ran and returned a result. |
| `bad_args` | Arguments failed schema validation — your handler never ran. |
| `tool_error` | Ran and returned `isError: true`. |
| `crashed` | Threw. |

Telling `crashed` from `tool_error` takes some doing. `McpServer` catches
everything a tool does and converts it into `{ isError: true }`, so from outside
its request handler a crash, a returned error and a rejected set of arguments
are the same object. The SDK wraps your tool callbacks as well as the request,
so what actually happened is known rather than guessed from an error message.

`is_empty` marks a call that succeeded and returned nothing useful — an empty
array, an empty object, a blank string. Those are the failures nobody reports:
the protocol calls them success, the model gets nothing it can use, and you
never hear about it.

## The three rules

1. **Never throw.** Every entry point swallows. If MCPulse fails inside your
   tool call, your tool fails and you blame us — so if instrumentation cannot be
   attached, your server is handed back untouched and runs without analytics.
2. **Never block.** Record, buffer, return. Nothing awaits the network on the
   path a model is waiting on.
3. **Never store customer data.** Sizes and hashes only.

Payloads are batched and sent every 5 seconds or every 30 calls, whichever
comes first, with a final flush on the way out. If the network is down the batch
is dropped rather than retried — the buffer is capped at 1000 and sheds the
oldest first, because your server running out of memory over our analytics is
the one failure we must never cause.

## Requirements

Node 20.12 or newer, and `@modelcontextprotocol/sdk` as a peer dependency —
whatever version your server already uses.

## Try it

`examples/test-server` is a real MCP server with one tool per behaviour: fast,
slow, empty, error, crash, and one registered but never called so dead-tool
detection has something to find.

```bash
cd examples/test-server
pnpm install
MCPULSE_KEY=mp_live_… MCPULSE_ENDPOINT=http://localhost:3000 pnpm exercise
```

`pnpm exercise` drives every behaviour once through a real MCP client and waits
for the send. `pnpm start` runs the same server over stdio for a real client to
connect to.

## Licence

MIT
