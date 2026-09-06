import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/canonical.json" with { type: "json" };
import { canonicalize } from "../src/canonical.js";
import { args_hash, UNHASHABLE } from "../src/hash.js";

/**
 * The cross-language contract.
 *
 * `tests/fixtures/canonical.json` is the shared conformance suite: a port of
 * this SDK to Python, Go or anything else runs the same file and must produce
 * the same two strings for every case. If this file passes here and there, the
 * two SDKs' hashes are interchangeable and a customer running both sees one
 * set of numbers rather than two.
 *
 * Regenerate the fixtures only to add cases — never to make a failure go away.
 * A changed hash here is a changed hash in the product's history.
 */

describe("rfc 8785 conformance fixtures", () => {
  it("pins the algorithm the fixtures were generated under", () => {
    expect(fixtures.algorithm).toBe("sha256/rfc8785/hex12");
    expect(fixtures.wire_version).toBe(1);
  });

  for (const fixture of fixtures.fixtures) {
    it(fixture.name, () => {
      expect(canonicalize(fixture.input)).toBe(fixture.canonical);
      expect(args_hash(fixture.input)).toBe(fixture.args_hash);
    });
  }

  it("hashes the canonical form, not the input", () => {
    // The one line a port has to get right after canonicalising: SHA-256 over
    // the UTF-8 bytes, hex, first twelve characters.
    for (const fixture of fixtures.fixtures) {
      const expected = createHash("sha256")
        .update(fixture.canonical, "utf8")
        .digest("hex")
        .slice(0, 12);
      expect(fixture.args_hash).toBe(expected);
    }
  });
});

describe("canonicalize", () => {
  it("refuses what JSON cannot represent", () => {
    // Coercing these to `null` the way `JSON.stringify` does would hand two
    // genuinely different calls the same hash.
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalize(1n)).toThrow();
    expect(() => canonicalize(undefined)).toThrow();
    expect(() => canonicalize(() => {})).toThrow();
  });

  it("refuses a circular structure rather than recursing forever", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalize(circular)).toThrow();
  });

  it("allows the same object twice when it is not a cycle", () => {
    const shared = { a: 1 };
    expect(canonicalize({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });

  it("drops undefined values but writes undefined array elements as null", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("honours toJSON, so a Date is its ISO string", () => {
    expect(canonicalize({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
  });

  it("escapes a lone surrogate", () => {
    // Deliberately not a shared fixture: Go's encoding/json replaces lone
    // surrogates with U+FFFD while parsing, so a Go port can never be handed
    // this input. The divergence is in the JSON parser, not in this module.
    expect(canonicalize({ s: "a\ud800b" })).toBe('{"s":"a\\ud800b"}');
  });
});

describe("args_hash", () => {
  it("treats absent arguments as the empty object", () => {
    // A no-argument tool is an ordinary call. Before this it collided with the
    // unhashable sentinel, which made every such tool look like a failure.
    expect(args_hash(undefined)).toBe(args_hash({}));
    expect(args_hash(undefined)).not.toBe(UNHASHABLE);
  });

  it("falls back to the sentinel rather than throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(args_hash(circular)).toBe(UNHASHABLE);
    expect(args_hash({ big: 1n })).toBe(UNHASHABLE);
  });
});
