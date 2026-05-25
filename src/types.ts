export type SymbolKind =
  | "class"
  | "constant"
  | "enum"
  | "enum-member"
  | "export"
  | "function"
  | "import"
  | "interface"
  | "method"
  | "property"
  | "type"
  | "variable";

export interface SymbolRecord {
  name: string;
  kind: SymbolKind;
  file: string;
  start: number;
  end: number;
  declarationStart?: number;
  declarationEnd?: number;
  line?: number;
  column?: number;
  container?: string;
  exported?: boolean;
  signature?: string;
  signatureStart?: number;
  signatureEnd?: number;
  parameters?: SymbolParameter[];
  returnType?: string;
  snippet?: string;
}

export interface SymbolSearchResult extends SymbolRecord {
  score: number;
  matches: number[];
}

export type SymbolScannerErrorKind = "file-read" | "parse" | "walk";

export interface SymbolScannerError {
  kind: SymbolScannerErrorKind;
  file: string;
  message: string;
  cause?: unknown;
}

export interface FileDiscoveryOptions {
  root?: string;
  cwd?: string;
  include?: readonly string[];
  exclude?: readonly string[];
  extensions?: readonly string[];
  signal?: AbortSignal;
}

export interface ExtractSymbolsOptions {
  symbolKinds?: readonly SymbolKind[];
  onError?: (error: SymbolScannerError) => void;
}

export interface ScanSymbolsOptions extends FileDiscoveryOptions, ExtractSymbolsOptions {}

export interface SearchSymbolsOptions extends ScanSymbolsOptions {
  limit?: number;
}

export interface ExtractedName {
  name: string;
  start: number;
  end: number;
}

export interface SymbolParameter {
  name: string;
  type?: string;
  optional?: boolean;
  rest?: boolean;
  default?: string;
}
