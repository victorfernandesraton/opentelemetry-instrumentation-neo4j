import type { Span } from "@opentelemetry/api";
import { context, trace } from "@opentelemetry/api";
import { sanitizeCypher } from "./cypher-sanitizer";
import { extractQuerySummary } from "./query-summary";
import {
  createQuerySpan,
  createSessionSpan,
  endSpan,
  parseConnectionUri,
} from "./span-builder";
import {
  OPERATION_CLOSE_SESSION,
  OPERATION_EXECUTE_READ,
  OPERATION_EXECUTE_WRITE,
  OPERATION_OPEN_SESSION,
  OPERATION_RUN,
} from "./semconv";
import type {
  Neo4jDriver,
  Neo4jSession,
  Neo4jTransaction,
} from "./internal-types";

const SESSION_SPAN_KEY = Symbol.for("otel.neo4j.sessionSpan");
const DRIVER_INFO_KEY = Symbol.for("otel.neo4j.driverInfo");

interface DriverInfo {
  serverAddress: string;
  serverPort: number;
  database: string;
}

let requireParentSpan = true;

export function configureSessionPatcher(
  config: { requireParentSpan?: boolean },
): void {
  requireParentSpan = config.requireParentSpan ?? true;
}

function getTracer() {
  return trace.getTracer("@opentelemetry/instrumentation-neo4j", "0.1.0");
}

function hasActiveSpan(): boolean {
  return trace.getActiveSpan() !== undefined;
}

export function wrapDriverSession(
  original: (...args: unknown[]) => Neo4jSession,
  driver: Neo4jDriver,
): (...args: unknown[]) => Neo4jSession {
  return function wrappedDriverSession(
    this: Neo4jDriver,
    ...args: unknown[]
  ): Neo4jSession {
    if (requireParentSpan && !hasActiveSpan()) {
      return original.apply(this, args);
    }

    const info = getOrSetDriverInfo(driver);

    const span = createSessionSpan(
      getTracer(),
      OPERATION_OPEN_SESSION,
      info.database,
      info.serverAddress,
      info.serverPort,
    );

    const ctx = trace.setSpan(context.active(), span);
    const session = context.with(ctx, () => original.apply(this, args));
    (session as unknown as Record<symbol, Span>)[SESSION_SPAN_KEY] = span;

    return session;
  };
}

export function wrapSessionClose(
  original: () => Promise<void>,
): (this: Neo4jSession) => Promise<void> {
  return async function wrappedSessionClose(this: Neo4jSession): Promise<void> {
    const sessionSpan = (this as unknown as Record<symbol, Span>)[
      SESSION_SPAN_KEY
    ]
    if (sessionSpan) {
      const info = getSessionInfo(this)
      createQuerySpan(
        getTracer(),
        OPERATION_CLOSE_SESSION,
        "",
        "",
        info.database,
        info.serverAddress,
        info.serverPort,
      ).end()
    }

    try {
      await original.call(this)
      if (sessionSpan) {
        endSpan(sessionSpan)
      }
    } catch (error) {
      if (sessionSpan) {
        endSpan(
          sessionSpan,
          error instanceof Error ? error : new Error(String(error)),
        )
      }
      throw error
    }
  };
}

export function wrapSessionRun(
  original: (query: string, params?: Record<string, unknown>) => unknown,
): (
  this: Neo4jSession,
  query: string,
  params?: Record<string, unknown>,
) => unknown {
  return function wrappedRun(
    this: Neo4jSession,
    query: string,
    params?: Record<string, unknown>,
  ) {
    if (requireParentSpan && !hasActiveSpan()) {
      return original.call(this, query, params);
    }

    const info = getSessionInfo(this);
    const sanitized = sanitizeCypher(query);
    const summary = extractQuerySummary(query);

    const span = createQuerySpan(
      getTracer(),
      OPERATION_RUN,
      sanitized,
      summary,
      info.database,
      info.serverAddress,
      info.serverPort,
    );

    const ctx = trace.setSpan(context.active(), span);
    const result = context.with(ctx, () => original.call(this, query, params));

    if (result && typeof result === "object" && "then" in result) {
      const promise = result as Promise<unknown>;
      return promise
        .then((value: unknown) => {
          endSpan(span);
          return value;
        })
        .catch((error: Error) => {
          endSpan(span, error);
          throw error;
        });
    }

    endSpan(span);
    return result;
  };
}

export function wrapSessionExecuteRead<T>(
  original: (fn: (txc: Neo4jTransaction) => Promise<T>) => Promise<T>,
): (
  this: Neo4jSession,
  fn: (txc: Neo4jTransaction) => Promise<T>,
) => Promise<T> {
  return async function wrappedExecuteRead(
    this: Neo4jSession,
    fn: (txc: Neo4jTransaction) => Promise<T>,
  ): Promise<T> {
    if (requireParentSpan && !hasActiveSpan()) {
      return original.call(this, fn);
    }

    const info = getSessionInfo(this);

    const span = createQuerySpan(
      getTracer(),
      OPERATION_EXECUTE_READ,
      "",
      "",
      info.database,
      info.serverAddress,
      info.serverPort,
    );

    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = await context.with(ctx, () => original.call(this, fn));
      endSpan(span);
      return result;
    } catch (error) {
      endSpan(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
}

export function wrapSessionExecuteWrite<T>(
  original: (fn: (txc: Neo4jTransaction) => Promise<T>) => Promise<T>,
): (
  this: Neo4jSession,
  fn: (txc: Neo4jTransaction) => Promise<T>,
) => Promise<T> {
  return async function wrappedExecuteWrite(
    this: Neo4jSession,
    fn: (txc: Neo4jTransaction) => Promise<T>,
  ): Promise<T> {
    if (requireParentSpan && !hasActiveSpan()) {
      return original.call(this, fn);
    }

    const info = getSessionInfo(this);

    const span = createQuerySpan(
      getTracer(),
      OPERATION_EXECUTE_WRITE,
      "",
      "",
      info.database,
      info.serverAddress,
      info.serverPort,
    );

    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = await context.with(ctx, () => original.call(this, fn));
      endSpan(span);
      return result;
    } catch (error) {
      endSpan(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  };
}

export function wrapBeginTransaction(
  original: () => Promise<Neo4jTransaction>,
): (this: Neo4jSession) => Promise<Neo4jTransaction> {
  return async function wrappedBeginTransaction(
    this: Neo4jSession,
  ): Promise<Neo4jTransaction> {
    const txc = await original.call(this);

    const originalTxcRun = txc.run.bind(txc);
    (txc as unknown as Record<string, CallableFunction>).run =
      wrapTransactionRun(originalTxcRun, this);

    return txc;
  };
}

function wrapTransactionRun(
  original: (query: string, params?: Record<string, unknown>) => unknown,
  session: Neo4jSession,
): (query: string, params?: Record<string, unknown>) => unknown {
  return function wrappedTxcRun(
    query: string,
    params?: Record<string, unknown>,
  ) {
    if (requireParentSpan && !hasActiveSpan()) {
      return original(query, params);
    }

    const info = getSessionInfo(session);
    const sanitized = sanitizeCypher(query);
    const summary = extractQuerySummary(query);

    const span = createQuerySpan(
      getTracer(),
      OPERATION_RUN,
      sanitized,
      summary,
      info.database,
      info.serverAddress,
      info.serverPort,
    );

    const ctx = trace.setSpan(context.active(), span);
    const result = context.with(ctx, () => original(query, params));

    if (result && typeof result === "object" && "then" in result) {
      const promise = result as Promise<unknown>;
      return promise
        .then((value: unknown) => {
          endSpan(span);
          return value;
        })
        .catch((error: Error) => {
          endSpan(span, error);
          throw error;
        });
    }

    endSpan(span);
    return result;
  };
}

function getOrSetDriverInfo(driver: Neo4jDriver): DriverInfo {
  const cached = (driver as unknown as Record<symbol, DriverInfo>)[
    DRIVER_INFO_KEY
  ];
  if (cached) return cached;

  const { serverAddress, serverPort } = parseConnectionUri(driver._url);
  const database = driver._config?.database ?? "";

  const info: DriverInfo = { serverAddress, serverPort, database };
  (driver as unknown as Record<symbol, DriverInfo>)[DRIVER_INFO_KEY] = info;
  return info;
}

function getSessionInfo(session: Neo4jSession): DriverInfo {
  const s = session as unknown as Record<string, string | number>;
  return {
    serverAddress: (s._serverAddress as string) ?? "localhost",
    serverPort: (s._serverPort as number) ?? 7687,
    database: (s._database as string) ?? "",
  };
}
