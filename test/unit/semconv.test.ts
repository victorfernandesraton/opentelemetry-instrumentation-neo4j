/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  ATTR_DB_SYSTEM,
  DB_SYSTEM_NEO4J,
  OPERATION_RUN,
  OPERATION_EXECUTE_READ,
  OPERATION_EXECUTE_WRITE,
  OPERATION_OPEN_SESSION,
  OPERATION_CLOSE_SESSION,
} from "../../src/semconv.ts"

describe("semconv", () => {
  it("defines all DB semconv constants", () => {
    assert.strictEqual(ATTR_DB_SYSTEM, "db.system.name")
    assert.strictEqual(DB_SYSTEM_NEO4J, "neo4j")
  })

  it("defines all operation name constants", () => {
    assert.strictEqual(OPERATION_RUN, "RUN")
    assert.strictEqual(OPERATION_EXECUTE_READ, "EXECUTE_READ")
    assert.strictEqual(OPERATION_EXECUTE_WRITE, "EXECUTE_WRITE")
    assert.strictEqual(OPERATION_OPEN_SESSION, "OPEN_SESSION")
    assert.strictEqual(OPERATION_CLOSE_SESSION, "CLOSE_SESSION")
  })
})
