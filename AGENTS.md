# AGENTS.md — otel-neo4j

## Overview

OpenTelemetry instrumentation for `neo4j-driver` (official Neo4j JavaScript driver). Monkey-patches the driver's Session API at module load time via `@opentelemetry/instrumentation` — **zero code changes** to existing Neo4j code.

Targets: **Node.js >= 20**, `@opentelemetry/sdk-node`.

## Package name convention

```
@opentelemetry/instrumentation-neo4j
```

## Architecture

### Patching strategy

The instrumentation wraps **`neo4j-driver`** at module load time via `InstrumentationBase`:

| Target | What | Span lifetime |
|--------|------|---------------|
| `driver.session` | Factory creating Session instances | Start on creation, end on `session.close()` |
| `Session.prototype.close` | Releases session to pool | Ends session span; sets ERROR on failure |
| `Session.prototype.run` | Primary query method | Per-query span, child of session span |
| `Session.prototype.executeRead` | Transaction function with retry | Per-operation span |
| `Session.prototype.executeWrite` | Transaction function with retry | Per-operation span |
| `Session.prototype.beginTransaction` | Explicit transaction | Span per `txc.run()`, child of session span |

Session lifecycle spans are parent spans for all queries within that session.

The instrumentation does **not** patch `rxSession()` or the reactive API in v1.

### Module registration

Finds `Session` in `neo4j-driver` module exports and patches its prototype directly. Works with driver versions `>=5.0.0 <7`. Both `lib/session.js` (5.x) and the `Session` export (6.x) are handled via iterative prototype detection.

### How patching works

Uses `InstrumentationBase._wrap()`:
1. Check if parent span exists (if `requireParentSpan: true`)
2. Create `CLIENT` span with database semconv attributes
3. Call original method
4. On resolution/error, set span status, call `responseHook`, end span

## Database semantic conventions

| Attribute | Source |
|-----------|--------|
| `db.system.name` | hardcoded: `"neo4j"` |
| `db.operation.name` | `"RUN"`, `"EXECUTE_READ"`, `"EXECUTE_WRITE"`, `"OPEN_SESSION"`, `"CLOSE_SESSION"` |
| `db.namespace` | from driver config `database` property |
| `db.query.text` | sanitized Cypher query |
| `db.query.summary` | clause extraction, e.g. `"MATCH Person RETURN"` |
| `server.address` | parsed from driver URI |
| `server.port` | parsed from driver URI (default `7687`) |

Optional: `db.response.status_code` (on errors), `error.type`, `db.query.parameter.<key>` (opt-in).

### Cypher sanitization

Literals replaced with `?`. Parameter placeholders (`$param`) preserved. Handles: strings, numbers, booleans, null, list/`[?]`, map/`{key: ?}`.

### Query summary

Extract clause keywords as low-cardinality summary, e.g.:
```
"MATCH (n:Person {name: 'Alice'}) RETURN n.name" → "MATCH Person RETURN"
```

## Key constraints

1. **No `import` from `neo4j-driver` in production code.** Only `import type` for types. `neo4j-driver` is a `devDependency` for tests only.
2. **`@opentelemetry/api` is a `peerDependency`**, not a `dependency`. Use `^1.0.0`.
3. **Do NOT patch `rxSession()` or reactive methods** in v1.
4. **`requireParentSpan: true`** by default.
5. **`neo4j-driver` must be required before the SDK starts** for module hooks to intercept it.
6. **In ESM projects, the tracing setup import must be the very first import** in the entry point file:

```ts
import "./tracing.js";           // 1st: SDK starts, hooks Module._load
import neo4j from "neo4j-driver"; // 2nd: intercepted automatically
```

No `--require`, `--import`, or preload needed. The import order alone ensures the hook is active before `neo4j-driver` is loaded.

## Directory structure

```
├── src/
│   ├── index.ts              # public exports
│   ├── instrumentation.ts    # Neo4jInstrumentation subclass
│   ├── types.ts              # public config types
│   ├── internal-types.ts     # internal driver types
│   ├── version.ts            # auto-generated version
│   ├── semconv.ts            # neo4j semconv values
│   ├── cypher-sanitizer.ts   # replaces Cypher literals with ?
│   ├── query-summary.ts      # extracts clause summary
│   ├── span-builder.ts       # creates CLIENT spans
│   └── session-patcher.ts    # wraps Session.prototype methods
├── test/
│   ├── unit/
│   │   ├── cypher-sanitizer.test.ts
│   │   ├── query-summary.test.ts
│   │   ├── semconv.test.ts
│   │   ├── session-patcher.test.ts
│   │   └── span-builder.test.ts
│   ├── integration/
│   │   └── instrumentation.test.ts
│   └── e2e/
│       ├── e2e-tracing.ts
│       └── e2e.test.ts
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── docker-compose.yml
└── README.md
```

## Public API

```ts
interface Neo4jInstrumentationConfig extends InstrumentationConfig {
  requireParentSpan?: boolean             // default true
  enhancedDatabaseReporting?: boolean     // default false
  responseHook?: (span: Span, response: { data: unknown }) => void
  dbStatementSerializer?: (query: string, params?: Record<string, unknown>) => string
}
```

## Build & test

- **Platform**: Node.js >= 20
- **Build**: `tsc -p tsconfig.build.json` with `target: ES2022`, `module: node16` (CJS output), output to `build/`
- **Test framework**: `node:test` + `node:assert/strict`, run via `tsx`
- **Import convention**: extensionless relative imports (matching OTel contrib pattern)
- **Tests require Neo4j** on `bolt://localhost:7687`

**Commands:**

```bash
# Single test file
npm test -- test/unit/cypher-sanitizer.test.ts

# All tests
npm run test:all

# Coverage
npm run test:cov

# Lint + type check
npm run check

# Lint only
npm run lint

# Type check only
npm run typecheck

# Production build (no sourcemaps, no test files)
npm run build

# Unit tests (no Neo4j required)
npm run test:unit

# Integration tests (require Neo4j, low-level setup
npm run test:integration

# E2E tests (require Neo4j, real NodeSDK + ESM import
npm run test:e2e
```

**Test strategy:**

- **Unit tests** (`test/unit/`): pure functions, no I/O
- **Integration tests** (`test/integration/`): starts `Neo4jInstrumentation` + `NodeTracerProvider` + `InMemorySpanExporter`, creates driver via `require()`, runs Cypher, asserts span attributes match database semconv
- **E2E tests** (`test/e2e/`): starts `NodeSDK` with `Neo4jInstrumentation`, `import` estático de `neo4j-driver` (interceptado pela ordem de import), asserts spans

## References

- [OTel JS Instrumentation Guidelines](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/GUIDELINES.md)
- [Database semantic conventions](https://opentelemetry.io/docs/specs/semconv/database/database-spans/)
- [Neo4j JS Driver API](https://neo4j.com/docs/api/javascript-driver/current/)
- [Example: mongodb instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-mongodb)
