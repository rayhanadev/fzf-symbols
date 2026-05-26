export { discoverFiles } from "./files.ts";
export { rankSymbols, scoreFuzzy } from "./fuzzy.ts";
export { getProjectIndexDirectory } from "./index-cache.ts";
export { scanSymbols, searchSymbols } from "./scanner.ts";
export { extractSymbolsFromSource } from "./symbols.ts";

export type {
  ExtractSymbolsOptions,
  FileDiscoveryOptions,
  ScanSymbolsOptions,
  SearchSymbolsOptions,
  SymbolKind,
  SymbolParameter,
  SymbolRecord,
  SymbolScannerError,
  SymbolScannerErrorKind,
  SymbolSearchResult,
} from "./types.ts";
