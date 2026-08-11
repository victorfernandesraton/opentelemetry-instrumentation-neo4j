import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractQuerySummary } from "../src/query-summary.js";

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
  });
});
