/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { NoopSpanProcessor } from "@opentelemetry/sdk-trace-base"
import {
  configureSessionPatcher,
  wrapBeginTransaction,
  wrapSessionExecuteRead,
  wrapSessionExecuteWrite,
  wrapSessionRun,
} from "../src/session-patcher.ts"
import type {
  Neo4jSession,
  Neo4jTransaction,
} from "../src/internal-types.ts"
import { fmt, measure, pct, type Stats } from "./measure.ts"

const ITERS = Number(process.env.BENCH_ITERS ?? 2000)
const WARMUP = Number(process.env.BENCH_WARMUP ?? 50)

function makeSession(): Neo4jSession {
  return {
    _serverAddress: "localhost",
    _serverPort: 7687,
    _database: "",
  } as unknown as Neo4jSession
}

function makeTxc(): Neo4jTransaction {
  return {
    run: async () => ({ records: [] }),
    commit: async () => {},
    rollback: async () => {},
  } as unknown as Neo4jTransaction
}

interface Row {
  name: string
  raw: Stats
  wrapped: Stats
}

async function compare(
  name: string,
  raw: () => Promise<void>,
  wrapped: () => Promise<void>,
): Promise<Row> {
  const wrappedStats = await measure(wrapped, {
    warmup: WARMUP,
    iterations: ITERS,
  })
  const rawStats = await measure(raw, { warmup: WARMUP, iterations: ITERS })
  return { name, raw: rawStats, wrapped: wrappedStats }
}

async function main(): Promise<void> {
  const provider = new NodeTracerProvider({
    spanProcessors: [new NoopSpanProcessor()],
  })
  provider.register()

  configureSessionPatcher({ requireParentSpan: false })

  const session = makeSession()
  const rawRun = async (_query: string) => ({ records: [] })
  const wrappedRun = wrapSessionRun(rawRun)

  const readWork = async (txc: Neo4jTransaction) => {
    await txc.run("RETURN 1 AS n")
    return "ok"
  }
  const rawRead = async (fn: (txc: Neo4jTransaction) => Promise<string>) =>
    fn(makeTxc())
  const wrappedRead = wrapSessionExecuteRead(rawRead)

  const writeWork = async (txc: Neo4jTransaction) => {
    await txc.run("RETURN 1 AS n")
    return "ok"
  }
  const rawWrite = async (fn: (txc: Neo4jTransaction) => Promise<string>) =>
    fn(makeTxc())
  const wrappedWrite = wrapSessionExecuteWrite(rawWrite)

  const rawBegin = async () => makeTxc()
  const wrappedBegin = wrapBeginTransaction(rawBegin)

  const rows: Row[] = []

  rows.push(
    await compare(
      "session.run",
      async () => {
        await rawRun.call(session, "RETURN 1 AS n")
      },
      async () => {
        await wrappedRun.call(session, "RETURN 1 AS n")
      },
    ),
  )

  rows.push(
    await compare(
      "executeRead (1x txc.run)",
      async () => {
        await rawRead(readWork)
      },
      async () => {
        await wrappedRead.call(session, readWork)
      },
    ),
  )

  rows.push(
    await compare(
      "executeWrite (1x txc.run)",
      async () => {
        await rawWrite(writeWork)
      },
      async () => {
        await wrappedWrite.call(session, writeWork)
      },
    ),
  )

  rows.push(
    await compare(
      "beginTransaction (1x txc.run + commit)",
      async () => {
        const txc = await rawBegin()
        await txc.run("RETURN 1 AS n")
        await txc.commit()
      },
      async () => {
        const txc = await wrappedBegin.call(session)
        await txc.run("RETURN 1 AS n")
        await txc.commit()
      },
    ),
  )

  configureSessionPatcher({ requireParentSpan: true })
  const skipRun = wrapSessionRun(rawRun)
  rows.push(
    await compare(
      "session.run (skip, sem parent)",
      async () => {
        await rawRun.call(session, "RETURN 1 AS n")
      },
      async () => {
        await skipRun.call(session, "RETURN 1 AS n")
      },
    ),
  )

  await provider.shutdown()

  console.log(
    `microbenchmark (iterations=${ITERS}, warmup=${WARMUP}, NoopSpanProcessor)`,
  )
  console.log(
    "op".padEnd(32) +
      "raw mean(ms)".padStart(14) +
      "wrapped mean(ms)".padStart(18) +
      "diff (µs)".padStart(11) +
      "raw ops/s".padStart(13) +
      "wrapped ops/s".padStart(15) +
      "overhead".padStart(10),
  )
  for (const row of rows) {
    const diffUs = (row.wrapped.meanMs - row.raw.meanMs) * 1000
    console.log(
      row.name.padEnd(32) +
        fmt(row.raw.meanMs, 3).padStart(14) +
        fmt(row.wrapped.meanMs, 3).padStart(18) +
        fmt(diffUs, 2).padStart(11) +
        fmt(row.raw.opsPerSec, 0).padStart(13) +
        fmt(row.wrapped.opsPerSec, 0).padStart(15) +
        pct(row.wrapped.meanMs, row.raw.meanMs).padStart(10),
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
