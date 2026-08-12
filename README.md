# OpenTelemetry neo4j Instrumentation for Node.js

[![npm version](https://badge.fury.io/js/otel-instrumentation-neo4j-node.svg)](https://www.npmjs.com/package/otel-instrumentation-neo4j-node)

OpenTelemetry instrumentation for `neo4j-driver` (the official Neo4j JavaScript driver). Automatically creates spans for Cypher queries, transactions, and session lifecycle — **zero code changes** to existing Neo4j code.

Compatible with `neo4j-driver` **>=5.0.0 <7**.

## Install

```bash
npm install otel-instrumentation-neo4j-node
```

**Peer dependencies** (already required by your OpenTelemetry setup):

```bash
npm install @opentelemetry/api
```

## Quick start (NodeSDK)

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Neo4jInstrumentation } from "otel-instrumentation-neo4j-node";

const sdk = new NodeSDK({
  instrumentations: [new Neo4jInstrumentation()],
  // ...exporter config...
});
sdk.start();

const neo4j = require("neo4j-driver");
const driver = neo4j.driver("neo4j://localhost", neo4j.auth.basic("neo4j", "password"));
const session = driver.session();
await session.run("MATCH (n) RETURN n"); // traced automatically
```

## ESM usage

In ESM projects (`"type": "module"`), the tracing setup must be the **very first import**:

```ts
import "./tracing.js";           // 1st: SDK starts, hooks Module._load
import neo4j from "neo4j-driver"; // 2nd: intercepted automatically
```

No `--require`, `--import`, or preload needed.

### ESM limitation: session lifecycle spans

Due to how Node.js creates ESM namespaces from CJS modules (snapshot at link time), `driver.session` wrapping does not propagate automatically in ESM. Query spans (`RUN`, `EXECUTE_READ`, `EXECUTE_WRITE`) work normally because `Session.prototype` is shared.

For `OPEN_SESSION` / `CLOSE_SESSION` spans in ESM, wrap `driver.session` manually after creating the driver:

```ts
import neo4j from "neo4j-driver";
import { wrapDriverSession } from "otel-instrumentation-neo4j-node/session-patcher";

const driver = neo4j.driver("neo4j://localhost", neo4j.auth.basic("neo4j", "password"));
driver.session = wrapDriverSession(driver.session.bind(driver), driver);
```

CJS users (`require`) do **not** need this workaround.
## Traced operations

| Operation | Span name | Attributes |
|-----------|-----------|------------|
| `driver.session()` | `OPEN_SESSION` | `server.address`, `server.port`, `db.namespace` |
| `session.close()` | `CLOSE_SESSION` | `server.address`, `server.port` |
| `session.run(cypher)` | `RUN` | `db.query.text` (sanitized), `db.query.summary` |
| `session.executeRead(fn)` | `EXECUTE_READ` | `server.address`, `server.port` |
| `session.executeWrite(fn)` | `EXECUTE_WRITE` | `server.address`, `server.port` |
| `session.beginTransaction()` | `RUN` (per `txc.run()`) | `db.query.text`, `db.query.summary` |

## Configuration

```ts
interface Neo4jInstrumentationConfig {
  requireParentSpan?: boolean;     // default: true
  enhancedDatabaseReporting?: boolean; // default: false
  responseHook?: (span: Span, response: { data: unknown }) => void;
  dbStatementSerializer?: (query: string, params?: Record<string, unknown>) => string;
}
```

### `requireParentSpan` (default: `true`)

When `true`, spans are only created when there is an active parent span in the current context. Set to `false` to trace all queries regardless of context.

### Cypher sanitization

Cypher queries are sanitized by default — literals (strings, numbers, booleans, null) are replaced with `?`. Parameter placeholders (`$param`) are preserved.

```
"MATCH (n:Person {name: 'Alice', age: 30}) RETURN n" → "MATCH (n:Person {name: ?, age: ?}) RETURN n"
```

## Test

```bash
# Unit tests (no Neo4j required)
npm run test:unit

# Integration tests (require Neo4j)
docker compose up -d
npm run test:integration

# E2E tests (require Neo4j)
npm run test:e2e

# All tests + coverage
npm run test:cov
```

## Semantic conventions

Follows [OpenTelemetry database semantic conventions](https://opentelemetry.io/docs/specs/semconv/database/database-spans/):

| Attribute | Value |
|-----------|-------|
| `db.system.name` | `"neo4j"` |
| `db.operation.name` | `"RUN"`, `"EXECUTE_READ"`, `"EXECUTE_WRITE"`, `"OPEN_SESSION"`, `"CLOSE_SESSION"` |
| `db.namespace` | Database name from driver config |
| `db.query.text` | Sanitized Cypher query |
| `db.query.summary` | Low-cardinality clause summary |
| `server.address` | Parsed from driver URI |
| `server.port` | Parsed from driver URI (default `7687`) |

## License

[Apache-2.0](LICENSE)
