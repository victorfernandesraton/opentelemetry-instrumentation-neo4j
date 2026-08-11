const CLAUSE_KEYWORDS = [
  "CALL",
  "CREATE",
  "DELETE",
  "DETACH",
  "FOREACH",
  "LOAD",
  "MATCH",
  "MERGE",
  "OPTIONAL",
  "REMOVE",
  "RETURN",
  "SET",
  "UNWIND",
  "WITH",
  "USE",
] as const;

export function extractQuerySummary(query: string): string {
  if (!query) return "";

  const tokens = tokenize(query);
  const summaryParts: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (isClauseKeyword(token)) {
      summaryParts.push(token);

      i++;
      while (i < tokens.length) {
        const next = tokens[i];
        if (isClauseKeyword(next)) break;

        if (next === ":" && i + 1 < tokens.length) {
          summaryParts.push(tokens[i + 1]);
          i += 2;
          continue;
        }
        i++;
      }
    } else {
      i++;
    }
  }

  const summary = summaryParts.join(" ");
  return summary.length > 255 ? summary.slice(0, 255) : summary;
}

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < query.length) {
    while (i < query.length && /\s/.test(query[i])) {
      i++;
    }
    if (i >= query.length) break;

    if (query[i] === "`") {
      let t = "";
      i++;
      while (i < query.length && query[i] !== "`") {
        t += query[i];
        i++;
      }
      i++;
      tokens.push(t);
      continue;
    }

    if (query[i] === "'" || query[i] === '"') {
      const quote = query[i];
      let t = quote;
      i++;
      while (i < query.length) {
        t += query[i];
        if (query[i] === "\\") {
          t += query[i + 1] || "";
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

    if (query[i] === "$") {
      let t = "$";
      i++;
      while (i < query.length && /[a-zA-Z0-9_]/.test(query[i])) {
        t += query[i];
        i++;
      }
      continue;
    }

    if (query[i] === ":" || query[i] === "," || query[i] === ";") {
      tokens.push(query[i]);
      i++;
      continue;
    }

    if (/[a-zA-Z_]/.test(query[i])) {
      let t = "";
      while (i < query.length && /[a-zA-Z0-9_]/.test(query[i])) {
        t += query[i];
        i++;
      }
      tokens.push(t);
      continue;
    }

    i++;
  }

  return tokens;
}

function isClauseKeyword(token: string): boolean {
  const upper = token.toUpperCase();
  return (CLAUSE_KEYWORDS as readonly string[]).includes(upper);
}
