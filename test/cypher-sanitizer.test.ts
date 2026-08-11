import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeCypher } from "../src/cypher-sanitizer.js";

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
  });
});
