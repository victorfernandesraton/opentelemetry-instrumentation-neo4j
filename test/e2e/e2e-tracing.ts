/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { NodeSDK } from "@opentelemetry/sdk-node"
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { Neo4jInstrumentation } from "../../src/instrumentation"

const exporter = new InMemorySpanExporter()

const sdk = new NodeSDK({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
  instrumentations: [new Neo4jInstrumentation({ requireParentSpan: false })],
})

sdk.start()

;(globalThis as Record<string, unknown>).__otelE2E = { exporter, sdk }
