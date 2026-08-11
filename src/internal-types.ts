/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Neo4jDriver {
  _config: { database?: string };
  _url: string;
  session: (...args: unknown[]) => Neo4jSession;
  close: () => Promise<void>;
}

export interface Neo4jSession {
  run: (query: string, params?: Record<string, unknown>) => Neo4jResult;
  executeRead: <T>(fn: (txc: Neo4jTransaction) => Promise<T>) => Promise<T>;
  executeWrite: <T>(fn: (txc: Neo4jTransaction) => Promise<T>) => Promise<T>;
  beginTransaction: () => Promise<Neo4jTransaction>;
  close: () => Promise<void>;
}

export interface Neo4jTransaction {
  run: (query: string, params?: Record<string, unknown>) => Neo4jResult;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
}

export interface Neo4jResult {
  records: unknown[];
  summary: unknown;
  then: <T>(
    onfulfilled?: (value: unknown) => T | PromiseLike<T>,
    onrejected?: (reason: unknown) => PromiseLike<never>,
  ) => Promise<T>;
}
