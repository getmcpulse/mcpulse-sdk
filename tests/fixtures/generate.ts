/**
 * Regenerates `canonical.json`, the cross-language conformance suite.
 *
 *   npx tsx tests/fixtures/generate.ts tests/fixtures/canonical.json
 *
 * Run this to ADD cases. Never run it to make a failing test pass: these
 * hashes are in the product's history, and rewriting them rewrites what every
 * stored row means.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { canonicalize } from "../../src/canonical.js";

const cases: Array<[string, unknown]> = [
  ["empty object", {}],
  ["empty array", []],
  ["literals", { t: true, f: false, n: null }],
  ["keys are sorted", { b: 2, a: 1, c: 3 }],
  ["keys are sorted at every depth", { o: { z: 1, a: { y: 1, b: 2 } } }],
  ["array order is preserved", { ids: [3, 1, 2] }],
  [
    "arrays of objects keep order, objects inside them sort",
    { xs: [{ b: 1, a: 2 }, { d: 1, c: 2 }] },
  ],

  // Python: json.dumps defaults to ensure_ascii=True and would escape these.
  ["non-ascii is never escaped", { s: "café", "clé": "naïve", emoji: "\u{1F680}" }],
  // Go: encoding/json HTML-escapes < > & unless SetEscapeHTML(false).
  ["html characters are not escaped", { s: "a<b>c&d" }],
  // JCS pins the short escapes; anything else under 0x20 is lowercase \u00xx.
  ["control characters use the short escape where one exists", { s: '\b\t\n\f\r"\\' }],
  ["other control characters are \\u00xx", { s: "\u0000\u0001\u001f" }],

  // Python: 1.0 stays "1.0"; ECMAScript and JCS both write "1".
  ["integral floats lose the decimal", { a: 1.0, b: -0.0, c: 2.5 }],
  [
    "number formats follow ecmascript",
    { a: 1e21, b: 1e-7, c: 0.1, d: 1e-6, e: 1.2345678901234568e29 },
  ],
  ["negative and exponent forms", { a: -1.5e-9, b: 1.7976931348623157e308, c: 5e-324 }],
  ["integers stay integers", { a: 0, b: -0, c: 9007199254740991, d: -9007199254740991 }],

  // UTF-16 code-unit order, not code-point order: U+1F680 is D83D DE80, so it
  // sorts BEFORE U+FFFD. Python (code point) and Go (UTF-8 bytes) disagree.
  ["keys sort by utf-16 code units", { "�": 1, "\u{1F680}": 2, "é": 3, a: 4 }],
  ["ascii key ordering is bytewise", { A: 1, a: 2, Z: 3, z: 4, "0": 5, _: 6 }],

  ["empty string key and value", { "": "" }],
  ["nested emptiness", { a: {}, b: [], c: [{}], d: [[]] }],
  ["deep nesting", { a: { b: { c: { d: { e: [1, { f: "g" }] } } } } }],
  ["null inside an array", { xs: [null, 1, null] }],

  // Realistic MCP tool arguments.
  [
    "a realistic call",
    { query: "quarterly revenue", limit: 25, filters: { region: "EMEA", active: true } },
  ],
  [
    "the same call, keys reordered",
    { filters: { active: true, region: "EMEA" }, limit: 25, query: "quarterly revenue" },
  ],
];

const fixtures = cases.map(([name, input]) => {
  const canonical = canonicalize(input);
  const hash = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
  return { name, input, canonical, args_hash: hash };
});

const file = {
  $comment:
    "Conformance fixtures for MCPulse args_hash. Every MCPulse SDK, in every language, must turn `input` into exactly `canonical` (RFC 8785) and then into `args_hash` (first 12 lowercase hex of the SHA-256 of the canonical form, UTF-8). Do not edit by hand.",
  wire_version: 1,
  algorithm: "sha256/rfc8785/hex12",
  fixtures,
};

const out = process.argv[2];
if (!out) throw new Error("usage: tsx tests/fixtures/generate.ts <output.json>");

writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
console.log(`wrote ${fixtures.length} fixtures`);
