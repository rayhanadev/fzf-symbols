import { discoverFiles } from "./files.ts";
import { rankSymbols } from "./fuzzy.ts";
import { scanSymbolsWithIndex } from "./index-cache.ts";

import type {
  ScanSymbolsOptions,
  SearchSymbolsOptions,
  SymbolRecord,
  SymbolSearchResult,
} from "./types.ts";

export async function scanSymbols(options: ScanSymbolsOptions = {}): Promise<SymbolRecord[]> {
  const files = await discoverFiles(options);
  return scanSymbolsWithIndex(files, options);
}

export async function searchSymbols(
  query: string,
  options: SearchSymbolsOptions = {},
): Promise<SymbolSearchResult[]> {
  const symbols = await scanSymbols(options);
  return rankSymbols(query, symbols, options.limit);
}
