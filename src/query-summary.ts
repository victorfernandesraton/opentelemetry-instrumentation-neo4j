/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

const STRING_PATTERN = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

const CLAUSE_PATTERN =
  /\b(?:CALL|CREATE|DELETE|DETACH|FOREACH|LOAD|MATCH|MERGE|OPTIONAL|REMOVE|RETURN|SET|UNWIND|WITH|USE)\b|:[A-Za-z_][A-Za-z0-9_]*/g

export function extractQuerySummary(query: string): string {
  if (!query) return ""

  const stripped = query.replace(STRING_PATTERN, " ")

  const tokens = stripped.match(CLAUSE_PATTERN) ?? []

  const summary = tokens
    .map((token) => (token.startsWith(":") ? token.slice(1) : token))
    .join(" ")

  return summary.length > 255 ? summary.slice(0, 255) : summary
}
