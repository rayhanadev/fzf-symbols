import { readFile } from "node:fs/promises";

import { discoverFiles } from "./files.ts";
import { rankSymbols } from "./fuzzy.ts";
import { extractSymbolsFromSource } from "./symbols.ts";

import type {
  ScanSymbolsOptions,
  SearchSymbolsOptions,
  SymbolRecord,
  SymbolSearchResult,
} from "./types.ts";

export async function scanSymbols(options: ScanSymbolsOptions = {}): Promise<SymbolRecord[]> {
  const files = await discoverFiles(options);
  const symbols: SymbolRecord[] = [];

  for (const file of files) {
    throwIfAborted(options.signal);

    try {
      const source = await readFile(file, "utf8");
      symbols.push(...extractSymbolsFromSource(file, source, options));
    } catch (cause) {
      options.onError?.({
        kind: "file-read",
        file,
        message: cause instanceof Error ? cause.message : "Failed to read file",
        cause,
      });
    }
  }

  return symbols;
}

export async function searchSymbols(
  query: string,
  options: SearchSymbolsOptions = {},
): Promise<SymbolSearchResult[]> {
  const symbols = await scanSymbols(options);
  return rankSymbols(query, symbols, options.limit);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Symbol scan aborted");
  }
}
