import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { context, trace } from "@opentelemetry/api"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import {
  configureSessionPatcher,
  wrapSessionClose,
  wrapSessionRun,
  wrapSessionExecuteRead,
  wrapSessionExecuteWrite,
  wrapBeginTransaction,
  wrapDriverSession,
} from "../../src/session-patcher.js"
import type {
  Neo4jDriver,
  Neo4jSession,
  Neo4jTransaction,
} from "../../src/internal-types.js"

describe("session-patcher", () => {
  let provider: NodeTracerProvider

  it("configureSessionPatcher defaults requireParentSpan to true", async () => {
    configureSessionPatcher({})

    const wrappedRun = wrapSessionRun(
      () => Promise.resolve({ records: [] }),
    )

    const session = {} as Neo4jSession
    const result = await wrappedRun.call(session, "RETURN 1")
    assert.ok(result)
  })

  it("wrapSessionClose records error on throw", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const span = trace.getTracer("test").startSpan("test")
    const session = {
      run: async () => ({ records: [] }),
      close: () => Promise.reject(new Error("session close failed")),
    } as unknown as Neo4jSession

    trace.setSpan(context.active(), span)
    ;(session as unknown as Record<symbol, unknown>)[
      Symbol.for("otel.neo4j.sessionSpan")
    ] = span

    const wrappedClose = wrapSessionClose(() =>
      Promise.reject(new Error("session close failed")),
    )

    await assert.rejects(
      () => wrappedClose.call(session),
      /session close failed/,
    )

    span.end()
    await provider.shutdown()
  })

  it("wrapSessionClose creates CLOSE_SESSION span", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const session = {
      run: async () => ({ records: [] }),
      close: () => Promise.resolve(),
    } as unknown as Neo4jSession

    const sessionSpan = trace.getTracer("test").startSpan("session-open")
    ;(session as unknown as Record<symbol, unknown>)[
      Symbol.for("otel.neo4j.sessionSpan")
    ] = sessionSpan

    const wrappedClose = wrapSessionClose(() => Promise.resolve())
    await wrappedClose.call(session)

    sessionSpan.end()
    await provider.shutdown()
  })

  it("wrapSessionRun records error on query failure", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrappedRun = wrapSessionRun(() =>
      Promise.reject(new Error("cypher error")),
    )

    const session = {} as Neo4jSession

    await assert.rejects(
      () => wrappedRun.call(session, "INVALID CYPHER") as Promise<unknown>,
      /cypher error/,
    )

    await provider.shutdown()
  })

  it("wrapSessionRun skips when requireParentSpan is true and no span", async () => {
    configureSessionPatcher({ requireParentSpan: true })

    const wrappedRun = wrapSessionRun(
      () => Promise.resolve({ records: [] }),
    )

    const session = {} as Neo4jSession
    const result = await wrappedRun.call(session, "RETURN 1")
    assert.ok(result)
  })

  it("wrapSessionExecuteRead creates OP EXECUTE_READ span", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrapped = wrapSessionExecuteRead(
      (fn: (txc: Neo4jTransaction) => Promise<string>) =>
        fn({} as unknown as Neo4jTransaction),
    )

    const session = {
      _serverAddress: "localhost",
      _serverPort: 7687,
      _database: "",
    } as unknown as Neo4jSession

    const result = await wrapped.call(session, () => Promise.resolve("read-result"))
    assert.strictEqual(result, "read-result")

    await provider.shutdown()
  })

  it("wrapSessionExecuteRead skips when requireParentSpan is true", async () => {
    configureSessionPatcher({ requireParentSpan: true })

    const wrapped = wrapSessionExecuteRead(
      (fn: (txc: Neo4jTransaction) => Promise<string>) =>
        fn({} as unknown as Neo4jTransaction),
    )

    const session = {} as Neo4jSession
    const result = await wrapped.call(session, () => Promise.resolve("read-result"))
    assert.strictEqual(result, "read-result")
  })

  it("wrapSessionExecuteWrite creates OP EXECUTE_WRITE span", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrapped = wrapSessionExecuteWrite(
      (fn: (txc: Neo4jTransaction) => Promise<string>) =>
        fn({} as unknown as Neo4jTransaction),
    )

    const session = {
      _serverAddress: "localhost",
      _serverPort: 7687,
      _database: "",
    } as unknown as Neo4jSession

    const result = await wrapped.call(session, () => Promise.resolve("write-result"))
    assert.strictEqual(result, "write-result")

    await provider.shutdown()
  })

  it("wrapSessionExecuteWrite skips when requireParentSpan is true", async () => {
    configureSessionPatcher({ requireParentSpan: true })

    const wrapped = wrapSessionExecuteWrite(
      (fn: (txc: Neo4jTransaction) => Promise<string>) =>
        fn({} as unknown as Neo4jTransaction),
    )

    const session = {} as Neo4jSession
    const result = await wrapped.call(session, () => Promise.resolve("write-result"))
    assert.strictEqual(result, "write-result")
  })

  it("wrapBeginTransaction wraps txc.run", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrapped = wrapBeginTransaction(async () =>
      ({
        run: async () => ({ records: [] }),
        commit: () => Promise.resolve(),
        rollback: () => Promise.resolve(),
      } as unknown as Neo4jTransaction),
    )

    const session = {
      _serverAddress: "localhost",
      _serverPort: 7687,
      _database: "",
    } as unknown as Neo4jSession
    const txc = await wrapped.call(session)

    const result = await txc.run("RETURN 1")
    assert.ok(result)
    await txc.commit()

    await provider.shutdown()
  })

  it("wrapBeginTransaction skips when requireParentSpan true", async () => {
    configureSessionPatcher({ requireParentSpan: true })

    const wrapped = wrapBeginTransaction(async () =>
      ({
        run: async () => ({ records: [] }),
        commit: () => Promise.resolve(),
        rollback: () => Promise.resolve(),
      } as unknown as Neo4jTransaction),
    )

    const session = {} as Neo4jSession
    const txc = await wrapped.call(session)
    const result = await txc.run("RETURN 1")
    assert.ok(result)
  })

  it("wrapSessionExecuteRead records error on failure", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrapped = wrapSessionExecuteRead<never>(() =>
      Promise.reject(new Error("read error")),
    )

    const session = {
      _serverAddress: "localhost",
      _serverPort: 7687,
      _database: "",
    } as unknown as Neo4jSession

    await assert.rejects(
      () => wrapped.call(session, () => Promise.reject(new Error("read error"))),
      /read error/,
    )

    await provider.shutdown()
  })

  it("wrapSessionExecuteWrite records error on failure", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrapped = wrapSessionExecuteWrite<never>(() =>
      Promise.reject(new Error("write error")),
    )

    const session = {
      _serverAddress: "localhost",
      _serverPort: 7687,
      _database: "",
    } as unknown as Neo4jSession

    await assert.rejects(
      () => wrapped.call(session, () => Promise.reject(new Error("write error"))),
      /write error/,
    )

    await provider.shutdown()
  })

  it("wrapBeginTransaction txc.run fails records error", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const wrapped = wrapBeginTransaction(async () =>
      ({
        run: () => Promise.reject(new Error("txc error")),
        commit: () => Promise.resolve(),
        rollback: () => Promise.resolve(),
      } as unknown as Neo4jTransaction),
    )

    const session = {
      _serverAddress: "localhost",
      _serverPort: 7687,
      _database: "",
    } as unknown as Neo4jSession
    const txc = await wrapped.call(session)

    await assert.rejects(() => txc.run("INVALID") as unknown as Promise<unknown>, /txc error/)

    await provider.shutdown()
  })

  it("wrapDriverSession skips when requireParentSpan is true", async () => {
    configureSessionPatcher({ requireParentSpan: true })

    const driver = {
      _config: { database: "" },
      _url: "bolt://localhost",
    } as unknown as Neo4jDriver

    const wrapped = wrapDriverSession(
      () => ({ run: async () => {}, close: async () => {} }) as unknown as Neo4jSession,
      driver,
    )

    const session = wrapped.call(driver)
    assert.ok(session)
    assert.ok(typeof session.run === "function")
  })

  it("wrapDriverSession creates session when requireParentSpan is false", async () => {
    provider = new NodeTracerProvider()
    provider.register()

    configureSessionPatcher({ requireParentSpan: false })

    const driver = {
      _config: { database: "" },
      _url: "bolt://localhost:7688",
    } as unknown as Neo4jDriver

    const wrapped = wrapDriverSession(
      () =>
        ({
          run: async () => {},
          close: async () => {},
        }) as unknown as Neo4jSession,
      driver,
    )

    const session = wrapped.call(driver)
    assert.ok(session)
    assert.strictEqual(
      (session as unknown as Record<symbol, unknown>)[
        Symbol.for("otel.neo4j.sessionSpan")
      ] !== undefined,
      true,
    )

    await provider.shutdown()
  })
})
