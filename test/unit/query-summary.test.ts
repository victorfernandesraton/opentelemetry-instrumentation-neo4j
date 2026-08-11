import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractQuerySummary } from "../../src/query-summary";

describe("query-summary", () => {
  describe("extractQuerySummary", () => {
    it("returns empty for empty input", () => {
      assert.strictEqual(extractQuerySummary(""), "");
    });

    it("extracts MATCH clause with labels", () => {
      const result = extractQuerySummary(
        "MATCH (n:Person {name: 'Alice'}) RETURN n.name",
      );
      assert(result.includes("MATCH"));
      assert(result.includes("Person"));
      assert(result.includes("RETURN"));
    });

    it("extracts MATCH and RETURN clauses", () => {
      const result = extractQuerySummary("MATCH (n) RETURN n");
      assert.strictEqual(result, "MATCH RETURN");
    });

    it("extracts MATCH Person", () => {
      const result = extractQuerySummary("MATCH (n:Person) RETURN n");
      assert.strictEqual(result, "MATCH Person RETURN");
    });

    it("extracts CREATE clause", () => {
      const result = extractQuerySummary(
        "CREATE (n:Person {name: $name}) RETURN n",
      );
      assert(result.includes("CREATE"));
      assert(result.includes("Person"));
      assert(result.includes("RETURN"));
    });

    it("extracts MERGE clause", () => {
      const result = extractQuerySummary(
        "MERGE (n:Person {name: $name}) RETURN n",
      );
      assert(result.includes("MERGE"));
      assert(result.includes("Person"));
      assert(result.includes("RETURN"));
    });

    it("handles OPTIONAL MATCH", () => {
      const result = extractQuerySummary(
        "MATCH (a:Person) OPTIONAL MATCH (a)-[:KNOWS]->(b) RETURN a, b",
      );
      assert(result.includes("MATCH"));
      assert(result.includes("OPTIONAL"));
      assert(result.includes("MATCH"));
    });

    it("handles multiple clauses", () => {
      const result = extractQuerySummary(
        "MATCH (n:Person) WHERE n.age > 30 RETURN n",
      );
      assert(result.includes("MATCH"));
      assert(result.includes("Person"));
      assert(result.includes("RETURN"));
    });

    it("extracts DELETE clause", () => {
      const result = extractQuerySummary("MATCH (n:Old) DELETE n");
      assert(result.includes("MATCH"));
      assert(result.includes("Old"));
      assert(result.includes("DELETE"));
    });

    it("extracts SET clause", () => {
      const result = extractQuerySummary("MATCH (n) SET n.updated = true");
      assert(result.includes("MATCH"));
      assert(result.includes("SET"));
    });

    it("truncates to 255 characters", () => {
      const longQuery =
        "MATCH (n:Person) RETURN n.name, n.email, n.phone, n.address, n.city, n.country, n.zip, n.age, n.gender, n.department, n.salary, n.startDate, n.endDate, n.manager, n.title, n.level, n.status, n.notes, n.createdAt, n.updatedAt";
      const result = extractQuerySummary(longQuery);
      assert(result.length <= 255);
    });

    it("handles backtick-quoted identifiers", () => {
      const result = extractQuerySummary(
        "MATCH (`Person`) RETURN `Person`",
      );
      assert(result.includes("MATCH"));
      assert(result.includes("RETURN"));
    });

    it("handles escaped quotes in strings", () => {
      const result = extractQuerySummary(
        "RETURN 'it\\'s working' AS text",
      );
      assert.strictEqual(result, "RETURN");
    });

    it("includes LOAD CSV clause", () => {
      const result = extractQuerySummary(
        "LOAD CSV FROM 'file.csv' AS row RETURN row",
      );
      assert(result.includes("LOAD"));
      assert(result.includes("RETURN"));
    });

    it("includes UNWIND clause", () => {
      const result = extractQuerySummary(
        "UNWIND [1, 2, 3] AS num RETURN num",
      );
      assert(result.includes("UNWIND"));
      assert(result.includes("RETURN"));
    });

    it("handles trailing whitespace", () => {
      const result = extractQuerySummary(
        "MATCH (n) RETURN n   ",
      );
      assert.strictEqual(result, "MATCH RETURN");
    });
  });
});
