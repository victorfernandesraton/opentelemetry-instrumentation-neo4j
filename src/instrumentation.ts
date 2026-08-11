import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from "@opentelemetry/instrumentation"
import type { InstrumentationModuleDefinition } from "@opentelemetry/instrumentation"
import type { Neo4jInstrumentationConfig } from "./types.js"
import type { Neo4jTransaction } from "./internal-types.js"
import {
  configureSessionPatcher,
  wrapBeginTransaction,
  wrapDriverSession,
  wrapSessionClose,
  wrapSessionExecuteRead,
  wrapSessionExecuteWrite,
  wrapSessionRun,
} from "./session-patcher.js"
import { VERSION } from "./version.js"

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

    const s = this

    return [
      new InstrumentationNodeModuleDefinition(
        "neo4j-driver",
        [">=5.0.0 <7"],
        (moduleExports, moduleVersion) => {
          s._diag.debug(`Patching neo4j-driver@${moduleVersion}`)

          const patchProto = (
            proto: Record<string, CallableFunction>,
          ) => {
            if (isWrapped(proto.run)) return
            if (proto.run) {
              s._wrap(proto, "run", (original) =>
                wrapSessionRun(
                  original as unknown as (
                    query: string,
                    params?: Record<string, unknown>,
                  ) => unknown,
                ),
              )
            }
            if (proto.executeRead) {
              s._wrap(proto, "executeRead", (original) =>
                wrapSessionExecuteRead(
                  original as unknown as (
                    fn: (txc: Neo4jTransaction) => Promise<unknown>,
                  ) => Promise<unknown>,
                ),
              )
            }
            if (proto.executeWrite) {
              s._wrap(proto, "executeWrite", (original) =>
                wrapSessionExecuteWrite(
                  original as unknown as (
                    fn: (txc: Neo4jTransaction) => Promise<unknown>,
                  ) => Promise<unknown>,
                ),
              )
            }
            if (proto.beginTransaction) {
              s._wrap(proto, "beginTransaction", (original) =>
                wrapBeginTransaction(
                  original as unknown as () => Promise<Neo4jTransaction>,
                ),
              )
            }
            if (proto.close) {
              s._wrap(proto, "close", (original) =>
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
            s._wrap(moduleExports, "driver", (original) => {
              return function wrappedDriver(
                this: unknown,
                ...args: unknown[]
              ) {
                const driver = original.apply(this, args)
                if (!isWrapped(driver.session)) {
                  s._wrap(driver, "session", (origSession) =>
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
          s._unwrap(moduleExports, "driver")

          const unpatchProto = (
            proto: Record<string, CallableFunction>,
          ) => {
            s._unwrap(proto, "run")
            s._unwrap(proto, "executeRead")
            s._unwrap(proto, "executeWrite")
            s._unwrap(proto, "beginTransaction")
            s._unwrap(proto, "close")
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
