import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { Neo4jInstrumentation } from "../src/instrumentation.js"

const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687"
const NEO4J_USER = process.env.NEO4J_USER || "neo4j"
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "password"

let driver: import("neo4j-driver").Driver
let exporter: InMemorySpanExporter
let provider: NodeTracerProvider

describe("Neo4jInstrumentation", () => {
  before(() => {
    const instrumentation = new Neo4jInstrumentation({
      requireParentSpan: false,
    })

    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    provider.register()

    instrumentation.setTracerProvider(provider)
    instrumentation.enable()

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const neo4j = require("neo4j-driver")
    driver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
    )
  })

  after(async () => {
    await driver?.close()
    await provider?.shutdown()
  })

  afterEach(() => {
    exporter.reset()
  })

  it("creates a span for session.run", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const neo4jSpan = spans.find(
      (s) => s.attributes["db.system.name"] === "neo4j",
    )

    assert.ok(neo4jSpan, "Expected a Neo4j span")
    assert.strictEqual(neo4jSpan.attributes["db.system.name"], "neo4j")
    assert.strictEqual(neo4jSpan.attributes["db.operation.name"], "RUN")
  })

  it("creates spans with sanitized query text", async () => {
    const session = driver.session()
    await session.run("CREATE (n:Person {name: 'Alice'}) RETURN n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const querySpan = spans.find((s) => s.attributes["db.query.text"])

    assert.ok(querySpan, "Expected span with query text")
    assert.strictEqual(
      querySpan.attributes["db.query.text"],
      "CREATE (n:Person {name: ?}) RETURN n",
    )
  })

  it("creates spans with extracted query summary", async () => {
    const session = driver.session()
    await session.run("MATCH (n:Person) RETURN n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const querySpan = spans.find((s) => s.attributes["db.query.summary"])

    assert.ok(querySpan, "Expected span with query summary")
    assert.strictEqual(
      querySpan.attributes["db.query.summary"],
      "MATCH Person RETURN",
    )
  })

  it("creates spans with server address and port", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const neo4jSpan = spans.find(
      (s) => s.attributes["db.system.name"] === "neo4j",
    )

    assert.ok(neo4jSpan, "Expected a Neo4j span")
    assert.strictEqual(neo4jSpan.attributes["server.address"], "localhost")
    assert.ok(neo4jSpan.attributes["server.port"], "Expected server.port")
  })

  it("creates a session span for open and close", async () => {
    const session = driver.session()
    await session.run("RETURN 2 AS n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const sessionSpans = spans.filter(
      (s) =>
        s.attributes["db.operation.name"] === "OPEN_SESSION" ||
        s.attributes["db.operation.name"] === "CLOSE_SESSION",
    )

    assert.ok(
      sessionSpans.length >= 1,
      `Expected at least 1 session span, got ${sessionSpans.length}`,
    )
  })
})
