/*
 * Copyright victorfernandesraton, opencode
 * SPDX-License-Identifier: Apache-2.0
 */

export function sanitizeCypher(query: string): string {
  if (!query) return "";

  let result = "";
  let i = 0;

  while (i < query.length) {
    const char = query[i];

    if (char === "$") {
      const start = i;
      i++;
      while (i < query.length && /[a-zA-Z0-9_]/.test(query[i])) {
        i++;
      }
      result += query.slice(start, i);
      continue;
    }

    if (char === "'" || char === '"') {
      result += "?";
      const quote = char;
      i++;
      while (i < query.length) {
        if (query[i] === "\\") {
          i += 2;
          continue;
        }
        if (query[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (char === "[") {
      result += "[?]";
      i = findClosingBracket(query, i) + 1;
      continue;
    }

    if (char === "{") {
      result += sanitizeMapContent(query, i);
      i = findClosingBrace(query, i) + 1;
      continue;
    }

    const prevChar = result.length > 0 ? result[result.length - 1] : " ";
    const isIdentifierContext = /[a-zA-Z_.]/.test(prevChar);

    if (/[0-9]/.test(char) && !isIdentifierContext) {
      i++;
      while (i < query.length && /[0-9.eE]/.test(query[i])) {
        i++;
      }
      if (query[i - 1] === ".") {
        result += query.slice(i - 2, i - 1);
        i--;
        continue;
      }
      result += "?";
      continue;
    }

    if (
      query.slice(i, i + 4) === "true" &&
      !/[a-zA-Z0-9_]/.test(query[i + 4] || "")
    ) {
      result += "?";
      i += 4;
      continue;
    }

    if (
      query.slice(i, i + 5) === "false" &&
      !/[a-zA-Z0-9_]/.test(query[i + 5] || "")
    ) {
      result += "?";
      i += 5;
      continue;
    }

    if (
      query.slice(i, i + 4) === "null" &&
      !/[a-zA-Z0-9_]/.test(query[i + 4] || "")
    ) {
      result += "?";
      i += 4;
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

function sanitizeMapContent(query: string, start: number): string {
  let i = start + 1;
  let depth = 1;
  const entries: string[] = [];
  let key = "";
  let hasColon = false;

  while (i < query.length && depth > 0) {
    while (i < query.length && /\s/.test(query[i])) i++;
    if (i >= query.length) break;

    if (query[i] === "{") {
      depth++;
      i++;
      continue;
    }
    if (query[i] === "}") {
      depth--;
      i++;
      continue;
    }
    if (query[i] === ",") {
      if (key) {
        entries.push(hasColon ? key : key + ": ?");
      }
      key = "";
      hasColon = false;
      i++;
      continue;
    }
    if (query[i] === ":") {
      hasColon = true;
      i++;
      while (i < query.length && /\s/.test(query[i])) i++;

      if (query[i] === "$") {
        const valueStart = i;
        i++;
        while (i < query.length && /[a-zA-Z0-9_]/.test(query[i])) i++;
        key += ": " + query.slice(valueStart, i);
      } else {
        key += ": ?";
        while (
          i < query.length && query[i] !== "," && query[i] !== "}" &&
          query[i] !== "{"
        ) {
          if (query[i] === "'" || query[i] === '"') {
            const q = query[i];
            i++;
            while (i < query.length && query[i] !== q) {
              if (query[i] === "\\") i++;
              i++;
            }
            i++;
            continue;
          }
          i++;
        }
      }
      continue;
    }

    const identStart = i;
    while (i < query.length && /[a-zA-Z0-9_]/.test(query[i])) i++;
    key = query.slice(identStart, i);
  }

  if (key) {
    entries.push(hasColon ? key : key + ": ?");
  }

  return "{" + entries.join(", ") + "}";
}

function findClosingBracket(query: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < query.length && depth > 0) {
    if (query[i] === "[") depth++;
    if (query[i] === "]") depth--;
    i++;
  }
  return i - 1;
}

function findClosingBrace(query: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < query.length && depth > 0) {
    if (query[i] === "{") depth++;
    if (query[i] === "}") depth--;
    i++;
  }
  return i - 1;
}
