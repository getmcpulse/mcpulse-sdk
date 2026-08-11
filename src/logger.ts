/**
 * Debug output, on stderr.
 *
 * stdout is the transport for a stdio MCP server — a single stray line there
 * corrupts the JSON-RPC stream and takes the customer's server down with it.
 * This is the one thing in the package that would be trivially easy to get
 * wrong and catastrophic to ship, so it goes through one function.
 */
export function make_logger(debug: boolean) {
  if (!debug) return () => {};

  return (message: string, detail?: unknown) => {
    try {
      const suffix = detail === undefined ? "" : ` ${format(detail)}`;
      process.stderr.write(`[mcpulse] ${message}${suffix}\n`);
    } catch {
      /* Logging is never worth an exception. */
    }
  };
}

function format(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  try {
    return JSON.stringify(detail) ?? String(detail);
  } catch {
    return String(detail);
  }
}
