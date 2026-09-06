/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { env } from "node:process"
import { Neo4jInstrumentation } from "../src/instrumentation.ts"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import {
  InMemorySpanExporter,
  NoopSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { createRequire } from "node:module"
import { fmt, measure, pct, type Stats } from "./measure.ts"

const require = createRequire(import.meta.url)

const NEO4J_URI = env.NEO4J_URI || "bolt://localhost:7687"
const NEO4J_USER = env.NEO4J_USER || "neo4j"
const NEO4J_PASSWORD = env.NEO4J_PASSWORD || "password"

const ITERS = Number(env.BENCH_ITERS ?? 300)
const WARMUP = Number(env.BENCH_WARMUP ?? 20)
const RUNS = Number(env.BENCH_RUNS ?? 3)

type Driver = import("neo4j-driver").Driver

const SCENARIOS = ["baseline", "sdk", "noop", "memory", "skip"] as const
type Scenario = (typeof SCENARIOS)[number]

const SCENARIO_LABELS: Record<Scenario, string> = {
  baseline: "baseline (sem SDK)",
  sdk: "sdk (NoopSpanProcessor, sem instrumentation)",
  noop: "noop (instrumentation + NoopSpanProcessor)",
  memory: "memory (instrumentation + InMemorySpanExporter)",
  skip: "skip (instrumentation default, sem parent)",
}

async function benchOps(
  driver: Driver,
  opts: { warmup?: number; iterations?: number } = {},
): Promise<Record<string, Stats>> {
  const out: Record<string, Stats> = {}

  {
    const session = driver.session()
    out["session.run"] = await measure(
      async () => {
        await session.run("RETURN 1 AS n")
      },
      { warmup: opts.warmup ?? WARMUP, iterations: opts.iterations ?? ITERS },
    )
    await session.close()
  }

  {
    const session = driver.session()
    out["executeRead (1x txc.run)"] = await measure(
      async () => {
        await session.executeRead(async (txc) => {
          await txc.run("RETURN 1 AS n")
          return 1
        })
      },
      { warmup: opts.warmup ?? WARMUP, iterations: opts.iterations ?? ITERS },
    )
    await session.close()
  }

  {
    const session = driver.session()
    out["executeWrite (1x txc.run)"] = await measure(
      async () => {
        await session.executeWrite(async (txc) => {
          await txc.run("CREATE (n:Benc {v: 1}) RETURN n")
        })
      },
      { warmup: opts.warmup ?? WARMUP, iterations: opts.iterations ?? ITERS },
    )
    await session.close()
  }

  {
    const session = driver.session()
    out["beginTransaction (1x txc.run + commit)"] = await measure(
      async () => {
        const txc = await session.beginTransaction()
        await txc.run("RETURN 1 AS n")
        await txc.commit()
      },
      { warmup: opts.warmup ?? WARMUP, iterations: opts.iterations ?? ITERS },
    )
    await session.close()
  }

  return out
}

async function scenarioWorker(scenario: Scenario): Promise<void> {
  const neo4j = require("neo4j-driver")
  const auth = neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)

  let provider: NodeTracerProvider | undefined

  if (scenario === "sdk" || scenario === "noop" || scenario === "skip") {
    provider = new NodeTracerProvider({
      spanProcessors: [new NoopSpanProcessor()],
    })
    provider.register()
  } else if (scenario === "memory") {
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    })
    provider.register()
  }

  let instrumentation: Neo4jInstrumentation | undefined
  if (scenario === "noop" || scenario === "memory") {
    instrumentation = new Neo4jInstrumentation({ requireParentSpan: false })
  } else if (scenario === "skip") {
    instrumentation = new Neo4jInstrumentation()
  }

  if (instrumentation && provider) {
    instrumentation.setTracerProvider(provider)
    instrumentation.enable()
  }

  const driver = neo4j.driver(NEO4J_URI, auth)
  const stats = await benchOps(driver)

  const cleanupSession = driver.session()
  await cleanupSession.run("MATCH (n:Benc) DETACH DELETE n")
  await cleanupSession.close()

  await driver.close()
  await provider?.shutdown()

  console.log(JSON.stringify({ scenario, stats }))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function aggregate(runs: Record<string, Stats>[]): Record<string, Stats> {
  const ops = Object.keys(runs[0])
  const out: Record<string, Stats> = {}
  for (const op of ops) {
    const pick = (field: keyof Stats): number =>
      median(runs.map((run) => run[op][field] as number))
    out[op] = {
      iterations: pick("iterations"),
      totalMs: pick("totalMs"),
      opsPerSec: pick("opsPerSec"),
      meanMs: pick("meanMs"),
      p50Ms: pick("p50Ms"),
      p95Ms: pick("p95Ms"),
      minMs: pick("minMs"),
      maxMs: pick("maxMs"),
    }
  }
  return out
}

function runScenarioProcess(scenario: Scenario): Record<string, Stats> {
  const script = fileURLToPath(import.meta.url)
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "--scenario", scenario],
    { encoding: "utf8" },
  )

  if (child.status !== 0) {
    console.error(child.stderr)
    throw new Error(`benchmark scenario "${scenario}" failed`)
  }

  const lines = child.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const last = lines[lines.length - 1]
  const parsed = JSON.parse(last) as { scenario: string; stats: Record<string, Stats> }
  return parsed.stats
}

function printTable(results: Record<Scenario, Record<string, Stats>>): void {
  const baseline = results.baseline
  const sdk = results.sdk
  const ops = Object.keys(baseline)

  console.log(
    `e2e benchmark (iterations=${ITERS}, warmup=${WARMUP}, runs=${RUNS}, cenários em processos isolados)`,
  )
  console.log("overhead: baseline/sdk vs baseline; instrumentation vs sdk")
  console.log(
    "scenario".padEnd(46) +
      "op".padEnd(32) +
      "ops/s".padStart(10) +
      "mean(ms)".padStart(11) +
      "p95(ms)".padStart(10) +
      "overhead".padStart(10),
  )

  for (const op of ops) {
    const base = baseline[op]
    const sdkBase = sdk[op]
    for (const scenario of SCENARIOS) {
      const stats = results[scenario][op]
      const reference = scenario === "sdk" || scenario === "baseline"
        ? base
        : sdkBase
      console.log(
        SCENARIO_LABELS[scenario].padEnd(46) +
          op.padEnd(32) +
          fmt(stats.opsPerSec, 0).padStart(10) +
          fmt(stats.meanMs, 3).padStart(11) +
          fmt(stats.p95Ms, 3).padStart(10) +
          (scenario === "baseline"
            ? "-".padStart(10)
            : pct(stats.meanMs, reference.meanMs).padStart(10)),
      )
    }
  }
}

function parent(): void {
  const results = {} as Record<Scenario, Record<string, Stats>>
  for (const scenario of SCENARIOS) {
    const samples: Record<string, Stats>[] = []
    for (let i = 0; i < RUNS; i++) {
      samples.push(runScenarioProcess(scenario))
    }
    results[scenario] = aggregate(samples)
  }
  printTable(results)
}

if (process.argv.includes("--scenario")) {
  const index = process.argv.indexOf("--scenario")
  const scenario = process.argv[index + 1] as Scenario
  scenarioWorker(scenario).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  parent()
}
