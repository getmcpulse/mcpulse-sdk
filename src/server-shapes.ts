/**
 * The parts of an MCP server this package reaches for.
 *
 * Structural types rather than imports from `@modelcontextprotocol/sdk`: that
 * package is a peer dependency, so a customer on a version we were not built
 * against must still compile. Describing only the handful of members we touch
 * also makes the surface we depend on impossible to miss — if the SDK moves
 * any of these, it is this file that needs reading.
 */

export type RequestHandler = (request: McpRequest, extra: unknown) => unknown;

export interface McpRequest {
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
    clientInfo?: { name?: string; version?: string };
  };
}

/** A registered tool as `McpServer` stores it. `handler` is the author's callback. */
export interface RegisteredTool {
  handler?: unknown;
  enabled?: boolean;
}

/** The low-level `Server`, which is what actually dispatches requests. */
export interface LowLevelServer {
  _requestHandlers?: Map<string, RequestHandler>;
  setRequestHandler?: (schema: unknown, handler: RequestHandler) => void;
  getClientVersion?: () => { name?: string; version?: string } | undefined;
}

/** The high-level `McpServer`, when that is what was handed to `watch()`. */
export interface HighLevelServer {
  server?: LowLevelServer;
  _registeredTools?: Record<string, RegisteredTool>;
}

export type AnyServer = (LowLevelServer & HighLevelServer) | Record<string, unknown>;

/**
 * `McpServer` keeps the real dispatcher on `.server`; a low-level `Server` is
 * its own. Everything downstream works against the low-level one, so this is
 * the only place the difference matters.
 */
export function low_level_server(server: AnyServer): LowLevelServer | null {
  const high = server as HighLevelServer;
  if (high?.server && typeof high.server === "object") return high.server;

  const low = server as LowLevelServer;
  return low?._requestHandlers instanceof Map ? low : null;
}

/** The method names we wrap, spelled once. */
export const TOOLS_CALL = "tools/call";
export const TOOLS_LIST = "tools/list";
export const INITIALIZE = "initialize";
