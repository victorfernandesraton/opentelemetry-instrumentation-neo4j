/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCypher } from "../../src/cypher-sanitizer";

describe("cypher-sanitizer", () => {
  describe("sanitizeCypher", () => {
    it("returns empty string for empty input", () => {
      assert.strictEqual(sanitizeCypher(""), "");
    });

    it("preserves parameter placeholders", () => {
      const result = sanitizeCypher("MATCH (n) WHERE n.name = $name RETURN n");
      assert.strictEqual(result, "MATCH (n) WHERE n.name = $name RETURN n");
    });

    it("replaces string literals with ?", () => {
      const result = sanitizeCypher(
        "MATCH (n) WHERE n.name = 'Alice' RETURN n",
      );
      assert.strictEqual(result, "MATCH (n) WHERE n.name = ? RETURN n");
    });

    it("replaces double-quoted string literals", () => {
      const result = sanitizeCypher(
        'MATCH (n) WHERE n.name = "Alice" RETURN n',
      );
      assert.strictEqual(result, "MATCH (n) WHERE n.name = ? RETURN n");
    });

    it("replaces numeric literals", () => {
      const result = sanitizeCypher("MATCH (n) WHERE n.age > 30 RETURN n");
      assert.strictEqual(result, "MATCH (n) WHERE n.age > ? RETURN n");
    });

    it("replaces float literals", () => {
      const result = sanitizeCypher("MATCH (n) WHERE n.score > 3.14 RETURN n");
      assert.strictEqual(result, "MATCH (n) WHERE n.score > ? RETURN n");
    });

    it("replaces boolean true literal", () => {
      const result = sanitizeCypher("MATCH (n) WHERE n.active = true RETURN n");
      assert.strictEqual(result, "MATCH (n) WHERE n.active = ? RETURN n");
    });

    it("replaces boolean false literal", () => {
      const result = sanitizeCypher(
        "MATCH (n) WHERE n.active = false RETURN n",
      );
      assert.strictEqual(result, "MATCH (n) WHERE n.active = ? RETURN n");
    });

    it("replaces null literal", () => {
      const result = sanitizeCypher(
        "MATCH (n) WHERE n.optional = null RETURN n",
      );
      assert.strictEqual(result, "MATCH (n) WHERE n.optional = ? RETURN n");
    });

    it("replaces list literals", () => {
      const result = sanitizeCypher("RETURN [1, 2, 3] AS nums");
      assert.strictEqual(result, "RETURN [?] AS nums");
    });

    it("replaces map literals", () => {
      const result = sanitizeCypher("RETURN {name: 'Alice', age: 30} AS props");
      assert.strictEqual(result, "RETURN {name: ?, age: ?} AS props");
    });

    it("handles escaped string quotes", () => {
      const result = sanitizeCypher("RETURN 'it\\'s working' AS text");
      assert.strictEqual(result, "RETURN ? AS text");
    });

    it("preserves mixed parameterized and literal queries", () => {
      const result = sanitizeCypher("CREATE (n:Person {name: $name, age: 25})");
      assert.strictEqual(result, "CREATE (n:Person {name: $name, age: ?})");
    });

    it("handles query with no literals unchanged", () => {
      const result = sanitizeCypher("MATCH (n) RETURN n");
      assert.strictEqual(result, "MATCH (n) RETURN n");
    });

    it("preserves numbers in property names", () => {
      const result = sanitizeCypher("RETURN n.value1, n.value2");
      assert.strictEqual(result, "RETURN n.value1, n.value2");
    });

    it("handles number with trailing dot", () => {
      const result = sanitizeCypher("RETURN 3. AS n");
      assert.strictEqual(result, "RETURN ?. AS n");
    });

    it("handles nested map in map", () => {
      const result = sanitizeCypher(
        "RETURN {a: {b: 'inner'}} AS nested",
      );
      assert.strictEqual(result, "RETURN {a: {b: ?}} AS nested");
    });

    it("handles map with string keys", () => {
      const result = sanitizeCypher('RETURN { "key": "value" } AS m');
      assert.strictEqual(result, "RETURN { ?: ? } AS m");
    });

    it("handles special chars in map keys", () => {
      const result = sanitizeCypher("RETURN {@foo: 1} AS m");
      assert.strictEqual(result, "RETURN {@foo: ?} AS m");
    });

    it("handles list inside map value", () => {
      const result = sanitizeCypher("RETURN {a: $p, b: [1,2]} AS m");
      assert.strictEqual(result, "RETURN {a: $p, b: [?]} AS m");
    });

    it("handles unterminated string without hanging", () => {
      const result = sanitizeCypher("RETURN 'unterminated");
      assert.strictEqual(result, "RETURN 'unterminated");
    });

    it("handles unterminated map without hanging", () => {
      const result = sanitizeCypher("RETURN {a: 1");
      assert.strictEqual(result, "RETURN {a: ?");
    });

    it("handles placeholder followed by special char", () => {
      const result = sanitizeCypher("RETURN $@ AS x");
      assert.strictEqual(result, "RETURN $@ AS x");
    });

    it("preserves QPE quantifiers", () => {
      const result = sanitizeCypher(
        "MATCH SHORTEST 1 (a)(()-[:ROAD]->()){1,5}(b) RETURN b",
      );
      assert.strictEqual(
        result,
        "MATCH SHORTEST ? (a)(()-[:ROAD]->()){1,5}(b) RETURN b",
      );
    });
  });
});
