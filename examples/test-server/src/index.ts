import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { watch } from "@mcpulse/sdk";
import { build_test_server } from "./tools.js";

/**
 * The test server, over stdio — point a real MCP client at this.
 *
 * ```
 * MCPULSE_KEY=mp_live_… MCPULSE_ENDPOINT=http://localhost:3000 pnpm start
 * ```
 *
 * The two lines that matter are the import and the `watch()` call. Everything
 * else is an ordinary MCP server.
 */
const server = watch(build_test_server(), {
  key: process.env.MCPULSE_KEY ?? "",
  endpoint: process.env.MCPULSE_ENDPOINT,
  debug: true,
});

await server.connect(new StdioServerTransport());
