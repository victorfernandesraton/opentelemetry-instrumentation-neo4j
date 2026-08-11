/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, Tracer } from "@opentelemetry/api";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION,
  ATTR_DB_QUERY_SUMMARY,
  ATTR_DB_QUERY_TEXT,
  ATTR_DB_SYSTEM,
  ATTR_ERROR_TYPE,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  DB_SYSTEM_NEO4J,
} from "./semconv";

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export function createQuerySpan(
  tracer: Tracer,
  operation: string,
  query: string,
  querySummary: string,
  database: string,
  serverAddress: string,
  serverPort: number,
): Span {
  const span = tracer.startSpan(operation, {
    kind: SpanKind.CLIENT,
  });

  span.setAttribute(ATTR_DB_SYSTEM, DB_SYSTEM_NEO4J);
  span.setAttribute(ATTR_DB_OPERATION, operation);
  span.setAttribute(ATTR_DB_QUERY_TEXT, query);
  span.setAttribute(ATTR_DB_QUERY_SUMMARY, querySummary);
  span.setAttribute(ATTR_SERVER_ADDRESS, serverAddress);
  span.setAttribute(ATTR_SERVER_PORT, serverPort);

  if (database) {
    span.setAttribute(ATTR_DB_NAMESPACE, database);
  }

  return span;
}

export function createSessionSpan(
  tracer: Tracer,
  operation: string,
  database: string,
  serverAddress: string,
  serverPort: number,
): Span {
  const span = tracer.startSpan(operation, {
    kind: SpanKind.CLIENT,
  });

  span.setAttribute(ATTR_DB_SYSTEM, DB_SYSTEM_NEO4J);
  span.setAttribute(ATTR_DB_OPERATION, operation);
  span.setAttribute(ATTR_SERVER_ADDRESS, serverAddress);
  span.setAttribute(ATTR_SERVER_PORT, serverPort);

  if (database) {
    span.setAttribute(ATTR_DB_NAMESPACE, database);
  }

  return span;
}

export function endSpan(span: Span, error?: Error): void {
  if (error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.setAttribute(ATTR_ERROR_TYPE, error.name);
  }
  span.end();
}

export function parseConnectionUri(uri: string): {
  serverAddress: string;
  serverPort: number;
} {
  try {
    const url = new URL(uri);
    return {
      serverAddress: url.hostname,
      serverPort: parseInt(url.port, 10) || 7687,
    };
  } catch {
    return { serverAddress: "localhost", serverPort: 7687 };
  }
}
