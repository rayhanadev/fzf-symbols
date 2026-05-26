import type { SymbolParseError } from "./errors.ts";

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
  comments?: string[];
  commentStart?: number;
  commentEnd?: number;
  snippet?: string;
}

export interface SymbolSearchResult extends SymbolRecord {
  score: number;
  matches: number[];
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
}

export interface ScanSymbolsOptions extends FileDiscoveryOptions, ExtractSymbolsOptions {
  ignoreParseErrors?: boolean;
  onParseError?: (error: SymbolParseError) => void;
}

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
