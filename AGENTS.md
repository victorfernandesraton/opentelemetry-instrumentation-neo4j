# AGENTS.md — otel-neo4j

## Overview

OpenTelemetry instrumentation for `neo4j-driver` (the official Neo4j JavaScript driver). Follows the `@opentelemetry/instrumentation-*` pattern — monkey-patches the driver's Session API at the module level so existing Neo4j code requires **zero code changes**. Users only add this instrumentation to their OTel SDK init.

Targets: **Node.js** (`@opentelemetry/sdk-node`) and **Deno 2.0+** (via its built-in OTel runtime, using `npm:neo4j-driver`). The instrumentation approach differs per runtime — see the [Deno strategy](#deno-strategy) section.

## Package name convention

```
@opentelemetry/instrumentation-neo4j
```

## Architecture

### Patching strategy

The instrumentation wraps **`neo4j-driver`** at module load time by hooking `Session.prototype` and `driver()` factory methods:

| Target | What it patches | Span lifetime |
|--------|-----------------|---------------|
| `driver.session` | Factory that creates new Session instances | Start span on creation, end on `session.close()` |
| `Session.prototype.close` | Releases the session back to the connection pool | Ends the session span; force-flushes on error |
| `Session.prototype.run` | Primary query method — returns `Result` | Per-query span, child of session span |
| `Session.prototype.executeRead` | Transaction function with retry | Per-operation span, child of session span |
| `Session.prototype.executeWrite` | Transaction function with retry | Per-operation span, child of session span |
| `Session.prototype.beginTransaction` | Explicit transaction — wraps `txc.run()` on the returned Transaction | Span per `txc.run()`, child of session span |

Session lifecycle spans act as parent spans for all queries within that session. A session span spans from `driver.session()` to `session.close()`. If `close()` errors, the span ends with `ERROR` status.

The instrumentation does **not** patch the reactive API (`rxSession()`) in the first version. Reactive support requires patching RxJS observable chains and is deferred.

### How patching works

Uses `InstrumentationBase._wrap()` from `@opentelemetry/instrumentation`. On module load, each patched method is intercepted to:

1. Check if parent span exists (if `requireParentSpan` config is true)
2. Create a new `CLIENT` span with database semantic convention attributes
3. Call the original method
4. On resolution/error, set span status, call `responseHook`, end the span

### Module registration pattern

```ts
init() {
  return [
    new InstrumentationNodeModuleDefinition(
      'neo4j-driver',
      ['>=5.0.0 <7'],  // supported driver versions
      // modulePatch — wraps `driver()` factory to hook driver.session
      undefined,        // TODO: patch to instrument driver.session()
      undefined,
      [
        new InstrumentationNodeModuleFile(
          'neo4j-driver/lib/session.js',  // internal path to Session class
          ['>=5.0.0 <7'],
          patchSession,
          unpatchSession,
        ),
      ]
    ),
  ];
}
```

`patchSession` wraps `Session.prototype.run`, `.executeRead`, `.executeWrite`, `.beginTransaction`, and `.close`. The `driver()` factory modulePatch wraps the returned driver instance to instrument `driver.session()` — each session gets a span stored as a symbol property, which is ended on `session.close()`.

The exact internal paths (`lib/session.js`, `lib/transaction.js`) depend on driver version ranges. The `neo4j-driver@6.x` may have different internal paths than `5.x`. Support both by using multiple `InstrumentationNodeModuleFile` entries with specific version ranges.

## Database semantic conventions

The semconv registry already includes `neo4j` as a well-known `db.system.name` value.

### Attributes set on every span

| Attribute | Source |
|-----------|--------|
| `db.system.name` | hardcoded: `"neo4j"` |
| `db.operation.name` | `"RUN"` for `.run()`, `"EXECUTE_READ"` for `.executeRead()`, `"EXECUTE_WRITE"` for `.executeWrite()`, `"OPEN_SESSION"` for `driver.session()`, `"CLOSE_SESSION"` for `session.close()` |
| `db.namespace` | extracted from driver config's `database` property |
| `db.query.text` | the Cypher query string (sanitized) |
| `db.query.summary` | Cypher clause extraction (e.g., `"MATCH p:Person RETURN p"` -> `"MATCH Person RETURN p"` or `"MATCH"`) |
| `server.address` | parsed from driver URI (e.g., `neo4j://localhost` -> `localhost`) |
| `server.port` | parsed from driver URI (default `7687` for bolt) |

### Additional optional attributes

- `db.response.status_code` — set on errors from `Neo4jError.code`
- `error.type` — set on failures
- `db.query.parameter.<key>` — opt-in via config (`captureQueryParameters: true`), **disabled by default** (PII risk)

### Cypher sanitization

Cypher queries are **sanitized by default** (literal values replaced with `?`). Parameterized queries ARE captured as-is since they signal that sensitive data is in params. The sanitizer must handle:
- String literals: `'value'`, `"value"`
- Numeric literals: `123`, `3.14`
- Boolean literals: `true`, `false`
- Parameter placeholder: `$param` — NOT sanitized (already parameterized)
- List literals: `[1, 2, 3]` -> `[?]`
- Map literals: `{key: 'val'}` -> `{key: ?}`

### Query summary generation

Parse Cypher to extract leading clauses as a low-cardinality summary:
```
"MATCH (n:Person {name: 'Alice'}) RETURN n.name" -> "MATCH Person RETURN n.name"
```
Strip labels from the clause keywords. Truncate to 255 chars.

## Key constraints

1. **No `import` from `neo4j-driver` in production code.** The instrumented package must NOT be a `dependency` or `peerDependency`. Only use `import type` for types (they are elided at compile time). The instrumented package is a `devDependency` for tests only.

2. **`@opentelemetry/api` is a `peerDependency`**, not a `dependency`. Use `^1.0.0`.

3. **Do NOT patch `rxSession()` or reactive methods** in v1 — document it as a limitation.

4. **`requireParentSpan: true`** by default. This mirrors mongodb instrumentation behavior. Users who want standalone spans set `{ requireParentSpan: false }`.

5. **The Neo4j driver MUST be required/imported before the SDK starts**, otherwise the module hook won't intercept the Session class.

## Code style

- **Format and lint**: use Deno toolchain — `deno fmt` and `deno lint`
- **Editor**: Zed with Deno LSP (configured in `.zed/settings.json`). Deno LSP handles all `.ts` files; TypeScript/Node LSPs are disabled to avoid conflicts.
- **No trailing semicolons**, single quotes, 2-space indent (Deno defaults)

## Directory structure (planned)

```
packages/instrumentation-neo4j/
├── src/
│   ├── index.ts              # public exports (Node.js entry)
│   ├── instrumentation.ts    # Neo4jInstrumentation subclass (Node.js)
│   ├── deno.ts               # Deno entry: side-effect module that patches Session.prototype
│   ├── types.ts              # public config types
│   ├── internal-types.ts     # internal driver types (not exported)
│   ├── version.ts            # auto-generated package name/version
│   ├── semconv.ts            # neo4j-specific semconv values
│   ├── cypher-sanitizer.ts   # replaces Cypher literals with ?
│   ├── query-summary.ts      # extracts low-cardinality Cypher clause summary
│   ├── span-builder.ts       # creates CLIENT spans with DB semantic convention attributes
│   └── session-patcher.ts    # wraps Session.prototype methods for both runtimes
├── test/
│   ├── instrumentation.test.ts
│   ├── cypher-sanitizer.test.ts
│   └── query-summary.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```


## Public API (types.ts)

```ts
interface Neo4jInstrumentationConfig extends InstrumentationConfig {
  requireParentSpan?: boolean;           // default true
  enhancedDatabaseReporting?: boolean;  // default false — pass full query params
  responseHook?: (span: Span, response: { data: unknown }) => void;
  dbStatementSerializer?: (query: string, params?: Record<string, unknown>) => string;
}
```

## Build & test

### Node.js (>= 20)

- **Build**: `tsc` with `target: ES2022`, `module: commonjs`, output to `build/`
- **Test framework**: `node:test` + `node:assert` (built-in, Node 20+)
- **Tests require a running Neo4j instance.** Use `neo4j-driver` + a local Neo4j or `neo4j:testcontainer` Docker image

**Node.js test strategy:**

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// Register the instrumentation via the SDK
const sdk = new NodeSDK({
  instrumentations: [new Neo4jInstrumentation()],
  spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
});
sdk.start();

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic("neo4j", "password"));

describe("Neo4jInstrumentation", () => {
  it("creates a span for session.run", async () => {
    const session = driver.session();
    await session.run("RETURN 1 AS n");
    await session.close();

    const finishedSpans = inMemoryExporter.getFinishedSpans();
    const neo4jSpan = finishedSpans.find(s =>
      s.attributes["db.system.name"] === "neo4j"
    );

    assert.ok(neo4jSpan, "Expected a Neo4j span");
    assert.strictEqual(neo4jSpan.attributes["db.system.name"], "neo4j");
    assert.strictEqual(neo4jSpan.attributes["db.operation.name"], "RUN");
  });
});
```

- **Unit tests** (`cypher-sanitizer.test.ts`, `query-summary.test.ts`): no Neo4j required — test pure functions with expected input/output
- **Integration tests** (`instrumentation.test.ts`): requires a running Neo4j instance at `neo4j://localhost:7687` (or `NEO4J_URI` env var). Ingests spans via `InMemorySpanExporter` and asserts attributes against database semantic conventions
- **Run single test**: `node --require ts-node/register --test test/cypher-sanitizer.test.ts`
- **Run integration tests**: `NEO4J_URI=bolt://localhost:7687 node --require ts-node/register --test test/instrumentation.test.ts`

### Deno

- **Test command**: `deno test --allow-net --allow-env`
- **No build step** — Deno runs `.ts` directly
- **Tests require a running Neo4j instance** accessible from the test runner
- **Console exporter** (`OTEL_EXPORTER_OTLP_PROTOCOL=console`) for local debugging with human-readable span output

**Deno test strategy:**

```ts
// deno test setup — OTel enabled via env var, console exporter writes spans to stderr
// OTEL_DENO=true OTEL_EXPORTER_OTLP_PROTOCOL=console deno test --allow-net --allow-env

import "@opentelemetry/instrumentation-neo4j/deno";  // patches Session.prototype
import neo4j from "npm:neo4j-driver";
import { trace } from "npm:@opentelemetry/api@1";
import { assertEquals, assertExists } from "jsr:@std/assert";

const NEO4J_URI = Deno.env.get("NEO4J_URI") ?? "neo4j://localhost:7687";

Deno.test("session.run creates a span", async () => {
  const tracerProvider = new NodeTracerProvider();
  const exporter = new InMemorySpanExporter();
  tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  tracerProvider.register();

  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic("neo4j", "password"));
  const session = driver.session();

  await trace.getTracer("test").startActiveSpan("test-parent", async (span) => {
    await session.run("RETURN 1 AS n");
    span.end();
  });

  await session.close();
  await driver.close();

  const finishedSpans = exporter.getFinishedSpans();
  const neo4jSpan = finishedSpans.find(s =>
    s.attributes["db.system.name"] === "neo4j"
  );

  assertExists(neo4jSpan, "Expected a Neo4j span");
  assertEquals(neo4jSpan.attributes["db.system.name"], "neo4j");
  assertEquals(neo4jSpan.attributes["db.operation.name"], "RUN");
});
```

- **Use `Deno.test`** (Deno's native test framework) with `@std/assert` for assertions
- **In-memory span recording**: import `@opentelemetry/sdk-trace-node` via `npm:` specifier to create a `NodeTracerProvider` with `InMemorySpanExporter` (Deno's built-in OTel auto-configuration does not expose the tracer provider for inspection)
- **Permissions required**: `--allow-net` (Neo4j Bolt connection), `--allow-env` (`NEO4J_URI`, `OTEL_*` vars)
- **Unit tests** (`cypher-sanitizer.test.ts`, `query-summary.test.ts`): run identically in both runtimes — pure functions, no I/O
- **Run Deno integration tests**:
  ```
  OTEL_DENO=true OTEL_EXPORTER_OTLP_PROTOCOL=console deno test --allow-net --allow-env test/instrumentation.deno.test.ts
  ```

## Deno strategy

### Runtime facts (verified against Deno 2.x docs)

- **Built-in OTel**: Deno enables OpenTelemetry by setting `OTEL_DENO=true`. It auto-configures the OTLP exporter (`http/protobuf`, `http/json`, `grpc`, or `console`) and auto-instruments `Deno.serve`, `fetch`, and `console.*`. **No SDK setup code needed.**
- **`@opentelemetry/api` is auto-configured**: `npm:@opentelemetry/api@1` works out of the box — no need to call `trace.setGlobalTracerProvider()`, `metrics.setGlobalMeterProvider()`, or `context.setGlobalContextManager()`. Import and use `trace.getTracer()` / `trace.startActiveSpan()` directly.
- **npm packages work**: `npm:neo4j-driver` is importable in Deno 2.0+ via `import neo4j from "npm:neo4j-driver"`. No need for a separate Deno-specific driver.
- **Context propagation uses `AsyncContext`** (TC39 proposal), not `async_hooks`/`AsyncLocalStorage`. This means the active span propagates correctly across async boundaries without any special patching.
- **ESM-first, no `require()` interceptor module hooks**: Deno uses ESM natively. While it supports CommonJS via `require()` in `.cjs` files, the `@opentelemetry/instrumentation` base class relies on `require-in-the-middle` which hooks `Module._load` — these Node.js internals are not replicated in Deno's compat layer.

### Instrumentation approach for Deno

The standard `InstrumentationBase` + `InstrumentationNodeModuleDefinition` pattern **does not work in Deno** because it depends on Node's `require()` interception. Instead, the Deno approach mirrors the same "init-only, no-wrapper" contract via **import-side-effect proxying**:

1. **A register module patches `Session.prototype` as a side-effect on import**, using `trace.getTracer()` from `@opentelemetry/api` (which Deno auto-configures — no SDK setup needed).
2. The user adds a single import to their OTel init file (equivalent to adding `new Neo4jInstrumentation()` in the Node SDK). **No changes to any Neo4j query code.**

```ts
// User's OTel init file (e.g., otel-init.ts or entry point)
import "@opentelemetry/instrumentation-neo4j/deno";  // side-effect: patches Session.prototype
// That's it. All subsequent session.run(), executeRead(), executeWrite() auto-create spans.
```

```ts
// User's app — ZERO changes needed
import neo4j from "npm:neo4j-driver";

const driver = neo4j.driver("neo4j://localhost", neo4j.auth.basic("neo4j", "password"));
const session = driver.session();
const result = await session.run("MATCH (n) RETURN n");  // traced automatically
```

3. **Alternatively, use `node:module` loader hooks** (Deno 2.x supports `registerHooks()` from `node:module`) to auto-instrument on import, achieving truly zero init code. This is aspirational — the side-effect import works today.
4. **Publish on JSR** as `@opentelemetry/instrumentation-neo4j` alongside the npm package. `session-patcher.ts`, `span-builder.ts`, `cypher-sanitizer.ts`, and `query-summary.ts` are imported by both the Node.js `instrumentation.ts` and the Deno `deno.ts` entry.
5. **Span attributes and behavior** match the Node.js instrumentation exactly — same `db.system.name`, same sanitization, same config options.

### What Deno users get for free

- Trace context propagates across `fetch()` calls automatically via W3C TraceContext (`traceparent`, `tracestate` headers) — the Neo4j driver's Bolt protocol uses the driver-level connection, but any HTTP calls the user makes in the same context are traced.
- `console.log` calls inside span callbacks are auto-attached to the span.
- `OTEL_DENO=true` with a local OTLP collector (e.g., Grafana LGTM Docker) gives full visibility without any SDK wiring.

### Deno limitations

- **No `@opentelemetry/instrumentation` base class**: we must implement patching logic directly without the module hook infrastructure.
- **Neo4j Driver must be importable after patching**: in Deno ESM, the import order matters. With `instrumentNeo4j()` called before `neo4j.driver()`, only objects created after patching are instrumented. If the driver is imported via a re-export pattern, patching may miss instances created before the call.
- **Mark Deno support as beta/experimental** initially. Do not gate Node.js development on Deno readiness.

## References

- [OTel JS Instrumentation Guidelines](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/GUIDELINES.md)
- [Database semantic conventions](https://opentelemetry.io/docs/specs/semconv/database/database-spans/)
- [Neo4j JS Driver API](https://neo4j.com/docs/api/javascript-driver/current/)
- [Example: mongodb instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-mongodb)
