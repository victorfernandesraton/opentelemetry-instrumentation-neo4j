/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import "./e2e-tracing"
import neo4j from "neo4j-driver"

import { after, afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import type { NodeSDK } from "@opentelemetry/sdk-node"
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { env } from "node:process"

const NEO4J_URI = env.NEO4J_URI || "bolt://localhost:7687"
const NEO4J_USER = env.NEO4J_USER || "neo4j"
const NEO4J_PASSWORD = env.NEO4J_PASSWORD || "password"

const { exporter, sdk } = (globalThis as Record<string, unknown>).__otelE2E as {
  exporter: InMemorySpanExporter
  sdk: NodeSDK
}

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
)

describe("Neo4j E2E (ESM + NodeSDK)", () => {
  after(async () => {
    await driver.close()
    await sdk.shutdown()
  })

  afterEach(() => {
    exporter.reset()
  })

  it("session.run gera span", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const span = spans.find(
      (s) => s.attributes["db.system.name"] === "neo4j",
    )

    assert.ok(span, "Expected a Neo4j span")
    assert.strictEqual(span.attributes["db.system.name"], "neo4j")
    assert.strictEqual(span.attributes["db.operation.name"], "RUN")
  })

  it("sanitiza query no span", async () => {
    const session = driver.session()
    await session.run("CREATE (n:Person {name: 'Alice'}) RETURN n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const span = spans.find((s) => s.attributes["db.query.text"])

    assert.ok(span, "Expected span with query text")
    assert.strictEqual(
      span.attributes["db.query.text"],
      "CREATE (n:Person {name: ?}) RETURN n",
    )
  })

  it("extrai query summary", async () => {
    const session = driver.session()
    await session.run("MATCH (n:Person) RETURN n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const span = spans.find((s) => s.attributes["db.query.summary"])

    assert.ok(span, "Expected span with query summary")
    assert.strictEqual(
      span.attributes["db.query.summary"],
      "MATCH Person RETURN",
    )
  })

  it("registra server.address e server.port", async () => {
    const session = driver.session()
    await session.run("RETURN 1 AS n")
    await session.close()

    await new Promise((resolve) => setTimeout(resolve, 200))

    const spans = exporter.getFinishedSpans()
    const span = spans.find(
      (s) => s.attributes["db.system.name"] === "neo4j",
    )

    assert.ok(span, "Expected a Neo4j span")
    assert.strictEqual(span.attributes["server.address"], "localhost")
    assert.ok(span.attributes["server.port"], "Expected server.port attribute")
  })

  it("cria span de sessao (open/close)", { todo: true }, async () => {
    // TODO: session lifecycle spans via ESM require manual driver.session
    // wrapping (see README.md ESM usage section for workaround).
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
      sessionSpans.length >= 2,
      `Expected at least 2 session spans, got ${sessionSpans.length}`,
    )
  })
})
