/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from "@opentelemetry/instrumentation"
import type { InstrumentationModuleDefinition } from "@opentelemetry/instrumentation"
import type { Neo4jInstrumentationConfig } from "./types"
import type { Neo4jTransaction } from "./internal-types"
import {
  configureSessionPatcher,
  wrapBeginTransaction,
  wrapDriverSession,
  wrapSessionClose,
  wrapSessionExecuteRead,
  wrapSessionExecuteWrite,
  wrapSessionRun,
} from "./session-patcher"
import { VERSION } from "./version"

export class Neo4jInstrumentation
  extends InstrumentationBase<Neo4jInstrumentationConfig> {
  constructor(config: Neo4jInstrumentationConfig = {}) {
    super("@opentelemetry/instrumentation-neo4j", VERSION, config)
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
        [">=5.0.0 <7"],
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

          const mod = moduleExports as Record<string, unknown>
          for (const key of Object.keys(mod)) {
            const val = mod[key]
            if (
              typeof val === "function" &&
              (val as { prototype?: { run?: unknown } }).prototype?.run
            ) {
              patchProto(
                (val as { prototype: Record<string, CallableFunction> })
                  .prototype,
              )
            }
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
}
