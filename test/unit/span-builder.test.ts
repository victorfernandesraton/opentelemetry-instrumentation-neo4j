/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import {
  createQuerySpan,
  createSessionSpan,
  endSpan,
  parseConnectionUri,
} from "../../src/span-builder.ts"

function newTracer() {
  const exporter = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const tracer = provider.getTracer("test")
  return { exporter, provider, tracer }
}

describe("span-builder", () => {
  it("createQuerySpan sets all attributes including database", async () => {
    const { exporter, provider, tracer } = newTracer()

    const span = createQuerySpan(
      tracer, "RUN", "RETURN 1", "RETURN",
      "mydb", "db.example.com", 9999,
    )
    span.end()

    const s = exporter.getFinishedSpans()[0]
    assert.strictEqual(s.attributes["db.system.name"], "neo4j")
    assert.strictEqual(s.attributes["db.operation.name"], "RUN")
    assert.strictEqual(s.attributes["db.query.text"], "RETURN 1")
    assert.strictEqual(s.attributes["db.query.summary"], "RETURN")
    assert.strictEqual(s.attributes["server.address"], "db.example.com")
    assert.strictEqual(s.attributes["server.port"], 9999)
    assert.strictEqual(s.attributes["db.namespace"], "mydb")

    await provider.shutdown()
  })

  it("createQuerySpan omits db.namespace when empty", async () => {
    const { exporter, provider, tracer } = newTracer()

    const span = createQuerySpan(
      tracer, "RUN", "RETURN 1", "RETURN",
      "", "localhost", 7687,
    )
    span.end()

    assert.strictEqual(
      exporter.getFinishedSpans()[0].attributes["db.namespace"], undefined,
    )
    await provider.shutdown()
  })

  it("createSessionSpan sets database when provided", async () => {
    const { exporter, provider, tracer } = newTracer()

    const span = createSessionSpan(
      tracer, "OPEN_SESSION", "mydb", "db.example.com", 9999,
    )
    span.end()

    const s = exporter.getFinishedSpans()[0]
    assert.strictEqual(s.attributes["db.namespace"], "mydb")
    assert.strictEqual(s.attributes["server.address"], "db.example.com")
    assert.strictEqual(s.attributes["server.port"], 9999)
    await provider.shutdown()
  })

  it("createSessionSpan omits db.namespace when empty", async () => {
    const { exporter, provider, tracer } = newTracer()

    const span = createSessionSpan(
      tracer, "OPEN_SESSION", "", "localhost", 7687,
    )
    span.end()

    assert.strictEqual(
      exporter.getFinishedSpans()[0].attributes["db.namespace"], undefined,
    )
    await provider.shutdown()
  })

  it("endSpan records error attributes on error", async () => {
    const { exporter, provider, tracer } = newTracer()

    const span = tracer.startSpan("test-span")
    endSpan(span, new TypeError("something broke"))

    assert.strictEqual(
      exporter.getFinishedSpans()[0].attributes["error.type"], "TypeError",
    )
    await provider.shutdown()
  })

  it("parseConnectionUri handles valid bolt URI", () => {
    const result = parseConnectionUri("bolt://db.example.com:9999")
    assert.strictEqual(result.serverAddress, "db.example.com")
    assert.strictEqual(result.serverPort, 9999)
  })

  it("parseConnectionUri defaults port to 7687", () => {
    const result = parseConnectionUri("bolt://localhost")
    assert.strictEqual(result.serverPort, 7687)
    assert.strictEqual(result.serverAddress, "localhost")
  })

  it("parseConnectionUri handles malformed URI gracefully", () => {
    const result = parseConnectionUri("not-a-valid-uri")
    assert.strictEqual(result.serverAddress, "localhost")
    assert.strictEqual(result.serverPort, 7687)
  })
})
