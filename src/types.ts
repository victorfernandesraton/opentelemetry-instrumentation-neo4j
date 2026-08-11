import type { InstrumentationConfig } from "@opentelemetry/instrumentation";
import type { Span } from "@opentelemetry/api";

export interface Neo4jInstrumentationConfig extends InstrumentationConfig {
  requireParentSpan?: boolean;
  enhancedDatabaseReporting?: boolean;
  responseHook?: (span: Span, response: { data: unknown }) => void;
  dbStatementSerializer?: (
    query: string,
    params?: Record<string, unknown>,
  ) => string;
}
