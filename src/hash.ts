import { createHash, randomBytes } from "node:crypto";

/**
 * A short, one-way fingerprint of a call's arguments.
 *
 * This is the only thing MCPulse ever learns about what was passed to a tool,
 * and it is deliberately not enough to learn anything: 12 hex characters of a
 * SHA-256, with no way back. All the product asks of it is "were these two
 * calls made with the same arguments or different ones" — which is what
 * separates a model retrying a reworded request from a client paging through
 * results.
 *
 * Keys are sorted first. Without that, `{a,b}` and `{b,a}` are the same call
 * with two different hashes, and every retry metric built on it is noise.
 */
export function args_hash(args: unknown): string {
  try {
    return createHash("sha256").update(stable_stringify(args)).digest("hex").slice(0, 12);
  } catch {
    // Unserialisable arguments (a BigInt, a circular structure). The call still
    // happened and still deserves a row; it simply cannot be compared to
    // another, so give it a constant that says exactly that.
    return "000000000000";
  }
}

/**
 * `JSON.stringify` with object keys in sorted order, at every depth.
 *
 * Array order is left alone — `[1,2]` and `[2,1]` are genuinely different
 * arguments, and sorting them would collapse two different calls into one.
 */
export function stable_stringify(value: unknown): string {
  return JSON.stringify(sort_deep(value));
}

function sort_deep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort_deep);

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sort_deep(source[key]);
    return sorted;
  }

  return value;
}

/**
 * Identifies one run of the customer's server, so calls can be grouped and a
 * cost-per-session worked out. Random rather than derived — there is nothing
 * about the process worth encoding here, and anything derived from the machine
 * would be an identifier we did not intend to collect.
 */
export function new_session_id(): string {
  return `s_${randomBytes(6).toString("hex")}`;
}
