import type { SymbolRecord, SymbolSearchResult } from "./types.ts";

interface FuzzyMatch {
  score: number;
  matches: number[];
}

interface PreparedQuery {
  raw: string;
  normalized: string;
}

export function rankSymbols(
  query: string,
  symbols: readonly SymbolRecord[],
  limit = 50,
): SymbolSearchResult[] {
  const preparedQuery = prepareQuery(query);

  if (preparedQuery.normalized.length === 0) {
    return [];
  }

  const results: SymbolSearchResult[] = [];

  for (const symbol of symbols) {
    const match = scoreFuzzy(preparedQuery, symbol.name);

    if (!match) {
      continue;
    }

    results.push({
      ...symbol,
      score: match.score,
      matches: match.matches,
    });
  }

  results.sort(compareSearchResults);
  return results.slice(0, Math.max(0, limit));
}

export function scoreFuzzy(
  query: string | PreparedQuery,
  candidate: string,
): FuzzyMatch | undefined {
  const preparedQuery = typeof query === "string" ? prepareQuery(query) : query;
  const normalizedQuery = preparedQuery.normalized;

  if (normalizedQuery.length === 0 || candidate.length === 0) {
    return undefined;
  }

  const normalizedCandidate = candidate.toLowerCase();
  const matches: number[] = [];
  let queryIndex = 0;
  let lastMatchIndex = -1;
  let score = 0;

  for (
    let candidateIndex = 0;
    candidateIndex < candidate.length && queryIndex < normalizedQuery.length;
    candidateIndex += 1
  ) {
    if (normalizedCandidate[candidateIndex] !== normalizedQuery[queryIndex]) {
      continue;
    }

    const gap = lastMatchIndex === -1 ? candidateIndex : candidateIndex - lastMatchIndex - 1;
    const isContiguous = lastMatchIndex === candidateIndex - 1;

    score += 10;

    if (candidateIndex === 0) {
      score += 14;
    }

    if (isWordBoundary(candidate, candidateIndex)) {
      score += 8;
    }

    if (isContiguous) {
      score += 6;
    } else {
      score -= Math.min(gap, 8) * 0.6;
    }

    if (candidate[candidateIndex] === preparedQuery.raw[queryIndex]) {
      score += 1;
    }

    matches.push(candidateIndex);
    lastMatchIndex = candidateIndex;
    queryIndex += 1;
  }

  if (queryIndex !== normalizedQuery.length) {
    return undefined;
  }

  score += (normalizedQuery.length / candidate.length) * 8;
  score -= candidate.length * 0.04;

  return { score, matches };
}

function prepareQuery(query: string): PreparedQuery {
  return {
    raw: query.trim(),
    normalized: query.trim().toLowerCase(),
  };
}

function compareSearchResults(left: SymbolSearchResult, right: SymbolSearchResult): number {
  return (
    right.score - left.score ||
    left.name.length - right.name.length ||
    left.file.localeCompare(right.file) ||
    left.name.localeCompare(right.name)
  );
}

function isWordBoundary(candidate: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  const previous = candidate[index - 1];
  const current = candidate[index];

  if (!previous || !current) {
    return false;
  }

  return (
    !isAlphaNumeric(previous) ||
    (isLower(previous) && isUpper(current)) ||
    (isDigit(previous) && !isDigit(current)) ||
    (!isDigit(previous) && isDigit(current))
  );
}

function isAlphaNumeric(value: string): boolean {
  return isLower(value) || isUpper(value) || isDigit(value);
}

function isLower(value: string): boolean {
  return value >= "a" && value <= "z";
}

function isUpper(value: string): boolean {
  return value >= "A" && value <= "Z";
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}
