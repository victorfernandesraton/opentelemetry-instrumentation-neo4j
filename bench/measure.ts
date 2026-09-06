/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { performance } from "node:perf_hooks"

export interface Stats {
  iterations: number
  totalMs: number
  opsPerSec: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
}

export async function measure(
  fn: () => Promise<void>,
  opts: { warmup?: number; iterations?: number } = {},
): Promise<Stats> {
  const warmup = opts.warmup ?? 20
  const iterations = opts.iterations ?? 300

  for (let i = 0; i < warmup; i++) {
    await fn()
  }

  const samples: number[] = []
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await fn()
    samples.push(performance.now() - t0)
  }
  const totalMs = performance.now() - start

  samples.sort((a, b) => a - b)
  const sum = samples.reduce((acc, v) => acc + v, 0)

  return {
    iterations,
    totalMs,
    opsPerSec: (iterations / totalMs) * 1000,
    meanMs: sum / iterations,
    p50Ms: samples[Math.floor(iterations * 0.5)],
    p95Ms: samples[Math.floor(iterations * 0.95)],
    minMs: samples[0],
    maxMs: samples[iterations - 1],
  }
}

export function fmt(value: number, digits = 2): string {
  return value.toFixed(digits)
}

export function pct(newValue: number, base: number): string {
  if (base === 0) return "n/a"
  return `${((newValue / base - 1) * 100).toFixed(1)}%`
}
