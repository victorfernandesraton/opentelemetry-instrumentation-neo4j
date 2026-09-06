/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { after, afterEach, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { env } from "node:process"
import { createRequire } from "node:module"
import { trace } from "@opentelemetry/api"

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { Neo4jInstrumentation } from "../../src/instrumentation.ts"

const require = createRequire(import.meta.url)

const NEO4J_URI = env.NEO4J_URI || "bolt://localhost:7687"
const NEO4J_USER = env.NEO4J_USER || "neo4j"
const NEO4J_PASSWORD = env.NEO4J_PASSWORD || "password"

const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

let driver: import("neo4j-driver").Driver
let exporter: InMemorySpanExporter
let provider: NodeTracerProvider
let instrumentation: Neo4jInstrumentation

describe("Neo4jInstrumentation", () => {
  before(() => {
    instrumentation = new Neo4jInstrumentation({
      requireParentSpan: false,
    })

    exporter = new InMemorySpanExporter()
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })
    provider.register()

    instrumentation.setTracerProvider(provider)
    instrumentation.enable()

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

  it("cria um span RUN para session.run", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const runSpans = spans.filter(
      (s) => s.attributes["db.operation.name"] === "RUN",
    )

    assert.strictEqual(runSpans.length, 1)
    assert.strictEqual(runSpans[0].attributes["db.system.name"], "neo4j")
    assert.strictEqual(runSpans[0].attributes["db.operation.name"], "RUN")
  })

  it("3x session.run gera exatamente 3 spans RUN com spanIds unicos", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.run("RETURN 2 AS n")
    await session.run("RETURN 3 AS n")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const runSpans = spans.filter(
      (s) => s.attributes["db.operation.name"] === "RUN",
    )
    assert.strictEqual(runSpans.length, 3)

    const ids = spans.map((s) => s.spanContext().spanId)
    assert.strictEqual(new Set(ids).size, ids.length)
  })

  it("cria spans com query sanitizada", async () => {
    const session = driver.session()
    await session.run("CREATE (n:Person {name: 'Alice'}) RETURN n")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const querySpan = spans.find((s) => s.attributes["db.query.text"])

    assert.ok(querySpan, "Expected span with query text")
    assert.strictEqual(
      querySpan.attributes["db.query.text"],
      "CREATE (n:Person {name: ?}) RETURN n",
    )
  })

  it("cria spans com summary extraido", async () => {
    const session = driver.session()
    await session.run("MATCH (n:Person) RETURN n")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const querySpan = spans.find((s) => s.attributes["db.query.summary"])

    assert.ok(querySpan, "Expected span with query summary")
    assert.strictEqual(
      querySpan.attributes["db.query.summary"],
      "MATCH Person RETURN",
    )
  })

  it("registra server.address e server.port", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const neo4jSpan = spans.find(
      (s) => s.attributes["db.system.name"] === "neo4j",
    )

    assert.ok(neo4jSpan, "Expected a Neo4j span")
    assert.strictEqual(neo4jSpan.attributes["server.address"], "localhost")
    assert.ok(neo4jSpan.attributes["server.port"], "Expected server.port")
  })

  it("sessao gera 1 OPEN_SESSION e 1 CLOSE_SESSION", async () => {
    const session = driver.session()
    await session.run("RETURN 2 AS n")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const open = spans.filter(
      (s) => s.attributes["db.operation.name"] === "OPEN_SESSION",
    )
    const close = spans.filter(
      (s) => s.attributes["db.operation.name"] === "CLOSE_SESSION",
    )

    assert.strictEqual(open.length, 1)
    assert.strictEqual(close.length, 1)
  })

  it("executeRead sem txc.run gera 1 EXECUTE_READ e 0 RUN", async () => {
    const session = driver.session()
    await session.executeRead(async () => "done")
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    assert.strictEqual(
      spans.filter((s) => s.attributes["db.operation.name"] === "EXECUTE_READ")
        .length,
      1,
    )
    assert.strictEqual(
      spans.filter((s) => s.attributes["db.operation.name"] === "RUN").length,
      0,
    )
  })

  it("executeRead com 2x txc.run gera 1 EXECUTE_READ + 2 RUN (sem duplicar)", async () => {
    const session = driver.session()
    await session.executeRead(async (txc) => {
      await txc.run("RETURN 1 AS n")
      await txc.run("RETURN 2 AS n")
      return "done"
    })
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    const readSpans = spans.filter(
      (s) => s.attributes["db.operation.name"] === "EXECUTE_READ",
    )
    const runSpans = spans.filter(
      (s) => s.attributes["db.operation.name"] === "RUN",
    )

    assert.strictEqual(readSpans.length, 1)
    assert.strictEqual(runSpans.length, 2)

    const ids = spans.map((s) => s.spanContext().spanId)
    assert.strictEqual(new Set(ids).size, ids.length)

    for (const run of runSpans) {
      assert.strictEqual(
        run.parentSpanContext?.spanId,
        readSpans[0].spanContext().spanId,
      )
    }
  })

  it("executeWrite com 1x txc.run gera 1 EXECUTE_WRITE + 1 RUN", async () => {
    const session = driver.session()
    await session.executeWrite(async (txc) => {
      await txc.run("CREATE (n:Person {name: 'Alice'}) RETURN n")
    })
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    assert.strictEqual(
      spans.filter(
        (s) => s.attributes["db.operation.name"] === "EXECUTE_WRITE",
      ).length,
      1,
    )
    assert.strictEqual(
      spans.filter((s) => s.attributes["db.operation.name"] === "RUN").length,
      1,
    )
  })

  it("beginTransaction com 2x txc.run gera exatamente 2 RUN (sem duplicar)", async () => {
    const session = driver.session()
    const txc = await session.beginTransaction()
    await txc.run("RETURN 1 AS n")
    await txc.run("RETURN 2 AS n")
    await txc.commit()
    await session.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    assert.strictEqual(
      spans.filter((s) => s.attributes["db.operation.name"] === "RUN").length,
      2,
    )
    assert.strictEqual(
      spans.filter(
        (s) => s.attributes["db.operation.name"] === "EXECUTE_READ" ||
          s.attributes["db.operation.name"] === "EXECUTE_WRITE",
      ).length,
      0,
    )

    const ids = spans.map((s) => s.spanContext().spanId)
    assert.strictEqual(new Set(ids).size, ids.length)
  })

  it("disable/enable nao acumula wrappers nem duplica spans", async () => {
    const runOnce = async (query: string) => {
      const session = driver.session()
      await session.run(query)
      await session.close()
    }

    await runOnce("RETURN 1 AS n")
    await settle()
    assert.strictEqual(
      exporter.getFinishedSpans().filter(
        (s) => s.attributes["db.operation.name"] === "RUN",
      ).length,
      1,
    )
    exporter.reset()

    instrumentation.disable()
    await runOnce("RETURN 2 AS n")
    await settle()
    assert.strictEqual(
      exporter.getFinishedSpans().filter(
        (s) => s.attributes["db.operation.name"] === "RUN",
      ).length,
      0,
    )
    exporter.reset()

    instrumentation.enable()
    await runOnce("RETURN 3 AS n")
    await settle()
    assert.strictEqual(
      exporter.getFinishedSpans().filter(
        (s) => s.attributes["db.operation.name"] === "RUN",
      ).length,
      1,
    )
  })

  it("duas sessoes geram 2 OPEN_SESSION + 2 CLOSE_SESSION + 2 RUN", async () => {
    const s1 = driver.session()
    const s2 = driver.session()
    await s1.run("RETURN 1 AS n")
    await s2.run("RETURN 2 AS n")
    await s1.close()
    await s2.close()

    await settle()

    const spans = exporter.getFinishedSpans()
    assert.strictEqual(
      spans.filter((s) => s.attributes["db.operation.name"] === "OPEN_SESSION")
        .length,
      2,
    )
    assert.strictEqual(
      spans.filter(
        (s) => s.attributes["db.operation.name"] === "CLOSE_SESSION",
      ).length,
      2,
    )
    assert.strictEqual(
      spans.filter((s) => s.attributes["db.operation.name"] === "RUN").length,
      2,
    )
  })

  it("rxSession nao e instrumentada (0 spans)", async () => {
    const rx = driver.rxSession()
    await rx.close()

    await settle()

    assert.strictEqual(
      exporter.getFinishedSpans().filter(
        (s) => s.attributes["db.operation.name"] !== undefined,
      ).length,
      0,
    )
  })

  it("requireParentSpan (default) nao gera spans sem parent, 1 span com parent", async () => {
    const defaultInstrumentation = new Neo4jInstrumentation()
    defaultInstrumentation.setTracerProvider(provider)
    defaultInstrumentation.enable()

    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await settle()

    assert.strictEqual(
      exporter.getFinishedSpans().filter(
        (s) => s.attributes["db.operation.name"] !== undefined,
      ).length,
      0,
    )
    exporter.reset()

    const tracer = trace.getTracer("neo4j-zero-span-test")
    await tracer.startActiveSpan("parent", async (span) => {
      const s2 = driver.session()
      await s2.run("RETURN 2 AS n")
      await s2.close()
      span.end()
    })

    await settle()

    assert.strictEqual(
      exporter.getFinishedSpans().filter(
        (s) => s.attributes["db.operation.name"] === "RUN",
      ).length,
      1,
    )

    defaultInstrumentation.disable()
  })
})
