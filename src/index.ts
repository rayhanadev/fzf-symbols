export { discoverFiles } from "./files.ts";
export {
  SymbolFileReadError,
  SymbolIndexWriteError,
  SymbolParseError,
  SymbolScanAbortedError,
  SymbolWalkError,
  TrufflerError,
} from "./errors.ts";
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
  SymbolSearchResult,
} from "./types.ts";
