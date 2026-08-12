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

  /**
   * Override enable() to force-load neo4j-driver via CJS require().
   * This ensures the module hooks fire even when the project uses ESM
   * imports (e.g., with tsx or type: "module") where the standard
   * Module._load interception may not trigger for ESM->CJS interop.
   */
  override enable(): void {
    super.enable()

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const neo4j = require("neo4j-driver") as Record<string, unknown>

      const mod = neo4j as Record<string, unknown> & {
        driver: (...args: unknown[]) => unknown
        Session?: { prototype: Record<string, CallableFunction> }
      }

      const { _wrap, _unwrap } = this

      // If hooks already patched via super.enable(), isWrapped will skip.
      // If the module was loaded via ESM before hooks were active,
      // Session.prototype won't be wrapped yet — patch it manually.
      const proto = findSessionProto(neo4j)
      if (proto && !isWrapped(proto.run)) {
        _wrap(proto, "run", (original) =>
          wrapSessionRun(
            original as unknown as (
              query: string,
              params?: Record<string, unknown>,
            ) => unknown,
          ),
        )
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

      if (!isWrapped(mod.driver)) {
        _wrap(mod, "driver", (original: unknown) =>
          function wrappedDriver(
            this: unknown,
            ...args: unknown[]
          ): unknown {
            const d = (original as (...args: unknown[]) => unknown).apply(
              this,
              args,
            ) as Record<string, CallableFunction>
            if (!isWrapped(d.session)) {
              _wrap(
                d,
                "session",
                (origSession: unknown) =>
                  wrapDriverSession(
                    origSession as unknown as (
                      ...a: unknown[]
                    ) => import("./internal-types").Neo4jSession,
                    d as unknown as import("./internal-types").Neo4jDriver,
                  ),
              )
            }
            return d
          },
        )
      }
    } catch {
      // neo4j-driver not installed — no-op
    }
  }
}

function findSessionProto(
  neo4jModule: Record<string, unknown>,
): Record<string, CallableFunction> | null {
  const sessionClass = neo4jModule.Session
  if (sessionClass) {
    return (sessionClass as { prototype: Record<string, CallableFunction> })
      .prototype
  }
  for (const key of Object.keys(neo4jModule)) {
    const val = neo4jModule[key]
    if (
      typeof val === "function" &&
      (val as { prototype?: { run?: unknown } }).prototype?.run
    ) {
      return (val as { prototype: Record<string, CallableFunction> }).prototype
    }
  }
  return null
}
