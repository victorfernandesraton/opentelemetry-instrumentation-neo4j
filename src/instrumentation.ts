/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from "node:module"
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from "@opentelemetry/instrumentation"
import type { InstrumentationModuleDefinition } from "@opentelemetry/instrumentation"
import type { Neo4jInstrumentationConfig } from "./types.ts"
import type { Neo4jTransaction } from "./internal-types.ts"
import {
  configureSessionPatcher,
  wrapBeginTransaction,
  wrapDriverSession,
  wrapSessionClose,
  wrapSessionExecuteRead,
  wrapSessionExecuteWrite,
  wrapSessionRun,
} from "./session-patcher.ts"
import { VERSION } from "./version.ts"

export class Neo4jInstrumentation
  extends InstrumentationBase<Neo4jInstrumentationConfig> {
  constructor(config: Neo4jInstrumentationConfig = {}) {
    super("otel-instrumentation-neo4j-node", VERSION, config)
  }

  protected init():
    | InstrumentationModuleDefinition
    | InstrumentationModuleDefinition[] {
    configureSessionPatcher({
      requireParentSpan: this._config?.requireParentSpan ?? true,
    })

    const { _wrap, _unwrap, _diag } = this

    return [
      new InstrumentationNodeModuleDefinition(
        "neo4j-driver",
        [">=6.0.0 <7"],
        (moduleExports, moduleVersion) => {
          _diag.debug(`Patching neo4j-driver@${moduleVersion}`)

          const patchProto = (
            proto: Record<string, CallableFunction>,
          ) => {
            if (isWrapped(proto.run)) return
            if (proto.run) {
              _wrap(proto, "run", (original) =>
                wrapSessionRun(
                  original as unknown as (
                    query: string,
                    params?: Record<string, unknown>,
                  ) => unknown,
                ),
              )
            }
            if (proto.executeRead) {
              _wrap(proto, "executeRead", (original) =>
                wrapSessionExecuteRead(
                  original as unknown as (
                    fn: (txc: Neo4jTransaction) => Promise<unknown>,
                  ) => Promise<unknown>,
                ),
              )
            }
            if (proto.executeWrite) {
              _wrap(proto, "executeWrite", (original) =>
                wrapSessionExecuteWrite(
                  original as unknown as (
                    fn: (txc: Neo4jTransaction) => Promise<unknown>,
                  ) => Promise<unknown>,
                ),
              )
            }
            if (proto.beginTransaction) {
              _wrap(proto, "beginTransaction", (original) =>
                wrapBeginTransaction(
                  original as unknown as () => Promise<Neo4jTransaction>,
                ),
              )
            }
            if (proto.close) {
              _wrap(proto, "close", (original) =>
                wrapSessionClose(original as unknown as () => Promise<void>),
              )
            }
          }

          const sessionClass = moduleExports.Session
          if (sessionClass?.prototype) {
            patchProto(sessionClass.prototype as Record<string, CallableFunction>)
          }

          if (!isWrapped(moduleExports.driver)) {
            _wrap(moduleExports, "driver", (original) => {
              return function wrappedDriver(
                this: unknown,
                ...args: unknown[]
              ) {
                const driver = original.apply(this, args)
                if (!isWrapped(driver.session)) {
                  _wrap(driver, "session", (origSession) =>
                    wrapDriverSession(origSession, driver),
                  )
                }
                return driver
              }
            })
          }

          return moduleExports
        },
        (moduleExports) => {
          _unwrap(moduleExports, "driver")

          const unpatchProto = (
            proto: Record<string, CallableFunction>,
          ) => {
            _unwrap(proto, "run")
            _unwrap(proto, "executeRead")
            _unwrap(proto, "executeWrite")
            _unwrap(proto, "beginTransaction")
            _unwrap(proto, "close")
          }

          const sessionClass = moduleExports.Session
          if (sessionClass?.prototype) {
            unpatchProto(
              sessionClass.prototype as Record<string, CallableFunction>,
            )
          }
        },
      ),
    ]
  }

  /**
   * Override enable() to force-load neo4j-driver via CJS require().
   * This ensures the Module._load hooks fire even when the project uses ESM
   * imports with tsx or "type": "module", triggering modulePatch which wraps
   * Session.prototype and driver.
   */
  override enable(): void {
    super.enable()

    createRequire(import.meta.url)("neo4j-driver")
  }
}
