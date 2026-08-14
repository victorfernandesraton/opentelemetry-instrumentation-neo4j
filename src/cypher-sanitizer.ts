/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

const STRING_PATTERN = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

const BOOLEAN_NULL_PATTERN = /\b(?:true|false|null)\b/g

const NUMBER_PATTERN = /(?<![.\w$])\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

const QPE_QUANTIFIER_PATTERN = /\{(\d+),(\d*)\}/g

const QPE_SENTINEL_PREFIX = "\u0000qpe"

export function sanitizeCypher(query: string): string {
  if (!query) return ""

  let sanitized = query

  const qpeQuantifiers: string[] = []
  sanitized = sanitized.replace(QPE_QUANTIFIER_PATTERN, (match) => {
    qpeQuantifiers.push(match)
    return `${QPE_SENTINEL_PREFIX}${qpeQuantifiers.length - 1}\u0000`
  })

  sanitized = sanitized.replace(STRING_PATTERN, "?")

  let previous: string
  do {
    previous = sanitized
    sanitized = sanitized.replace(/(?<![\w:-])\[(?:[^[\]]*)\]/g, "[?]")
  } while (sanitized !== previous)

  sanitized = sanitized.replace(BOOLEAN_NULL_PATTERN, "?")

  sanitized = sanitized.replace(NUMBER_PATTERN, "?")

  sanitized = sanitized.replace(
    new RegExp(`${QPE_SENTINEL_PREFIX}(\\d+)\u0000`, "g"),
    (_, index) => qpeQuantifiers[Number(index)],
  )

  return sanitized
}
