import type { SymbolRecord } from "../types.ts";

export interface ProjectIndexLocation {
  directory: string;
  file: string;
}

export interface V1CachedFile {
  hash: string;
  mtimeMs: number;
  size: number;
  symbols: SymbolRecord[];
}

export interface V1ProjectIndex {
  schemaVersion: number;
  extractorVersion: string;
  projectRoot: string;
  updatedAt: string;
  files: Record<string, V1CachedFile>;
}
