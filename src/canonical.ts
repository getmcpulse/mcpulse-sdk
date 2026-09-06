/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * `args_hash` only means anything if every MCPulse SDK, in every language,
 * turns the same arguments into the same bytes. "JSON.stringify with sorted
 * keys" does not survive that trip — it is a JavaScript behaviour, not a
 * portable one. The same call hashed by a TypeScript server and a Python one
 * would land in two different buckets, and the first-call-success metric built
 * on top would quietly become noise the moment a customer runs both.
 *
 * RFC 8785 is the fix, and it is a cheap one here: the spec was written to
 * match ECMAScript's own serialisation, so `JSON.stringify` is already the
 * reference implementation for the two hard parts — number formatting and
 * string escaping. What this module adds is the parts JCS pins down and
 * `JSON.stringify` leaves to the caller: key order at every depth, and a
 * refusal to emit anything JSON cannot represent.
 *
 * A port of this SDK to another language reimplements exactly these rules.
 * `tests/fixtures/canonical.json` is the shared conformance suite; if a port
 * passes it, its hashes match ours.
 */

/**
 * The canonical JSON form of a value, as a string.
 *
 * Throws on anything JSON cannot represent — `NaN`, `Infinity`, a `BigInt`, a
 * circular structure. Callers that must not fail catch it; see `args_hash`.
 */
export function canonicalize(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, seen: Set<object>): string {
  // Honour `toJSON` exactly where `JSON.stringify` would, so a `Date` that
  // reaches us serialises as its ISO string rather than as an empty object.
  // Arguments arrive JSON-parsed off the wire, so this is a safety net rather
  // than a path anything normally takes.
  if (value && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    value = (value as { toJSON: () => unknown }).toJSON();
  }

  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number":
      // JCS §3.2.2.3 defers to ECMAScript's Number::toString, which is what
      // `JSON.stringify` emits. `-0` serialises as `0` in both. Anything
      // non-finite is not JSON and must not be silently coerced to `null`.
      if (!Number.isFinite(value)) throw new TypeError("non-finite number");
      return JSON.stringify(value) as string;

    case "string":
      // JCS §3.2.2.2 is ECMAScript's escaping: shortest form for the control
      // characters, `"` and `\`, and no `\u` escaping of anything else. That
      // is `JSON.stringify` verbatim — note that ports must NOT escape
      // non-ASCII (Python's `ensure_ascii`) or HTML (Go's default).
      return JSON.stringify(value);

    case "object":
      break;

    // `undefined`, `bigint`, `function`, `symbol`.
    default:
      throw new TypeError(`cannot canonicalize ${typeof value}`);
  }

  const object = value as object;
  if (seen.has(object)) throw new TypeError("circular structure");
  seen.add(object);

  try {
    if (Array.isArray(object)) {
      // A hole or an `undefined` element is `null` on the wire, matching
      // `JSON.stringify`. Array order is meaningful and is left alone.
      const items = object.map((item) => (item === undefined ? "null" : write(item, seen)));
      return `[${items.join(",")}]`;
    }

    const source = object as Record<string, unknown>;
    const parts: string[] = [];

    // JCS §3.2.3 sorts keys by their UTF-16 code units, which is precisely
    // what a comparator-less `Array.prototype.sort` does. Ports must match
    // that and not their own default: Python sorts by code point and Go by
    // UTF-8 bytes, both of which disagree with UTF-16 above the BMP.
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      // An `undefined` value drops the key entirely, as `JSON.stringify` does.
      // Other languages have no such value, so nothing there needs this rule.
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${write(entry, seen)}`);
    }

    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(object);
  }
}
