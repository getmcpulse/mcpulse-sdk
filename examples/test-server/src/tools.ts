import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * One tool per behaviour MCPulse records, so every metric can be produced on
 * demand rather than waited for.
 *
 * Kept separate from the transport wiring because the end-to-end check drives
 * these same tools in-process, without a stdio client in the way.
 */
export function build_test_server(): McpServer {
  const server = new McpServer({ name: "mcpulse-test-server", version: "1.0.0" });

  server.registerTool(
    "fast_tool",
    {
      description: "Returns immediately. The healthy baseline everything else is measured against.",
      inputSchema: { query: z.string().describe("Anything at all") },
    },
    ({ query }) => ({ content: [{ type: "text" as const, text: `Found 3 results for ${query}` }] }),
  );

  server.registerTool(
    "slow_tool",
    {
      description: "Takes three seconds, to land in the over-2000ms latency bucket.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return { content: [{ type: "text" as const, text: `Slowly found ${query}` }] };
    },
  );

  server.registerTool(
    "empty_tool",
    {
      description: "Succeeds and returns an empty array — a failure that reports success.",
      inputSchema: { query: z.string() },
    },
    () => ({ content: [{ type: "text" as const, text: "[]" }] }),
  );

  server.registerTool(
    "error_tool",
    {
      description: "Returns isError: true, the polite way for a tool to fail.",
      inputSchema: { query: z.string() },
    },
    () => ({
      content: [{ type: "text" as const, text: "Upstream service refused the request" }],
      isError: true,
    }),
  );

  server.registerTool(
    "crash_tool",
    {
      description: "Throws. The impolite way.",
      inputSchema: { query: z.string() },
    },
    () => {
      throw new Error("Unhandled: connection reset while reading orders");
    },
  );

  server.registerTool(
    "dead_tool",
    {
      description:
        "Registered and never called. Exists to prove dead-tool detection — it costs schema bytes every session and returns nothing to anyone.",
      inputSchema: { query: z.string() },
    },
    () => ({ content: [{ type: "text" as const, text: "Nobody calls me" }] }),
  );

  return server;
}
