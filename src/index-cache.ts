import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { extractSymbolsFromSource } from "./symbols.ts";

import type { ScanSymbolsOptions, SymbolRecord, SymbolScannerError } from "./types.ts";

const INDEX_SCHEMA_VERSION = 1;
const EXTRACTOR_VERSION = "symbols-v1";
const INDEX_FILENAME = "symbols.json";

interface CachedFile {
  hash: string;
  mtimeMs: number;
  size: number;
  symbols: SymbolRecord[];
  errors?: CachedSymbolScannerError[];
}

interface CachedSymbolScannerError {
  kind: SymbolScannerError["kind"];
  file: string;
  message: string;
}

interface ProjectIndex {
  schemaVersion: number;
  extractorVersion: string;
  projectRoot: string;
  updatedAt: string;
  files: Record<string, CachedFile>;
}

interface FileState {
  mtimeMs: number;
  size: number;
}

interface ProjectIndexLocation {
  directory: string;
  file: string;
}

export async function scanSymbolsWithIndex(
  files: readonly string[],
  options: ScanSymbolsOptions,
): Promise<SymbolRecord[]> {
  const projectRoot = getProjectRoot(options);
  const location = getProjectIndexLocation(projectRoot);
  const index = await readProjectIndex(location.file, projectRoot);
  const symbols: SymbolRecord[] = [];
  let indexChanged = false;

  for (const file of files) {
    throwIfAborted(options.signal);

    const relativePath = toIndexPath(path.relative(projectRoot, file));
    const cached = index.files[relativePath];
    const state = await readFileState(file, options);

    if (!state) {
      continue;
    }

    if (cached && isFresh(cached, state)) {
      replayCachedErrors(cached, options);
      symbols.push(...filterSymbols(cached.symbols, options));
      continue;
    }

    const indexed = await indexFile(file, state, cached, options);

    if (!indexed) {
      continue;
    }

    index.files[relativePath] = indexed;
    indexChanged = true;
    symbols.push(...filterSymbols(indexed.symbols, options));
  }

  if (indexChanged) {
    index.updatedAt = new Date().toISOString();
    await writeProjectIndex(location, index);
  }

  return symbols;
}

export function getProjectIndexDirectory(projectRoot: string): string {
  return path.join(homedir(), ".truffler", "projects", createProjectSlug(projectRoot));
}

function getProjectRoot(options: ScanSymbolsOptions): string {
  return options.cwd ? path.resolve(options.cwd) : process.cwd();
}

function getProjectIndexLocation(projectRoot: string): ProjectIndexLocation {
  const directory = getProjectIndexDirectory(projectRoot);

  return {
    directory,
    file: path.join(directory, INDEX_FILENAME),
  };
}

async function readProjectIndex(file: string, projectRoot: string): Promise<ProjectIndex> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<ProjectIndex>;

    if (
      parsed.schemaVersion === INDEX_SCHEMA_VERSION &&
      parsed.extractorVersion === EXTRACTOR_VERSION &&
      parsed.projectRoot === projectRoot &&
      parsed.files &&
      typeof parsed.files === "object"
    ) {
      return parsed as ProjectIndex;
    }
  } catch {
    // A missing or unreadable index should never block a symbol scan.
  }

  return createEmptyProjectIndex(projectRoot);
}

function createEmptyProjectIndex(projectRoot: string): ProjectIndex {
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    projectRoot,
    updatedAt: new Date().toISOString(),
    files: {},
  };
}

async function readFileState(
  file: string,
  options: ScanSymbolsOptions,
): Promise<FileState | undefined> {
  try {
    const info = await stat(file);

    return {
      mtimeMs: info.mtimeMs,
      size: info.size,
    };
  } catch (cause) {
    options.onError?.({
      kind: "file-read",
      file,
      message: cause instanceof Error ? cause.message : "Failed to stat file",
      cause,
    });

    return undefined;
  }
}

function isFresh(cached: CachedFile, state: FileState): boolean {
  return cached.size === state.size && cached.mtimeMs === state.mtimeMs;
}

async function indexFile(
  file: string,
  state: FileState,
  cached: CachedFile | undefined,
  options: ScanSymbolsOptions,
): Promise<CachedFile | undefined> {
  let source: string;

  try {
    source = await readFile(file, "utf8");
  } catch (cause) {
    options.onError?.({
      kind: "file-read",
      file,
      message: cause instanceof Error ? cause.message : "Failed to read file",
      cause,
    });

    return undefined;
  }

  const hash = createContentHash(source);

  if (cached?.hash === hash) {
    const refreshed = {
      ...cached,
      mtimeMs: state.mtimeMs,
      size: state.size,
    };

    replayCachedErrors(refreshed, options);
    return refreshed;
  }

  const errors: CachedSymbolScannerError[] = [];
  const symbols = extractSymbolsFromSource(file, source, {
    onError: (error) => {
      options.onError?.(error);
      errors.push({
        kind: error.kind,
        file: error.file,
        message: error.message,
      });
    },
  });

  return {
    hash,
    mtimeMs: state.mtimeMs,
    size: state.size,
    symbols,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

function replayCachedErrors(cached: CachedFile, options: ScanSymbolsOptions): void {
  if (!cached.errors) {
    return;
  }

  for (const error of cached.errors) {
    options.onError?.(error);
  }
}

function filterSymbols(symbols: readonly SymbolRecord[], options: ScanSymbolsOptions): SymbolRecord[] {
  if (!options.symbolKinds) {
    return [...symbols];
  }

  const allowedKinds = new Set(options.symbolKinds);
  return symbols.filter((symbol) => allowedKinds.has(symbol.kind));
}

function createContentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function writeProjectIndex(location: ProjectIndexLocation, index: ProjectIndex): Promise<void> {
  await mkdir(location.directory, { recursive: true });

  const temporaryFile = path.join(
    location.directory,
    `${INDEX_FILENAME}.${process.pid}.${Date.now()}.tmp`,
  );

  await writeFile(temporaryFile, `${JSON.stringify(index)}\n`, "utf8");
  await rename(temporaryFile, location.file);
}

function createProjectSlug(projectRoot: string): string {
  const normalized = path.resolve(projectRoot).split(path.sep).filter(Boolean).join("-");
  const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");

  return safe || "root";
}

function toIndexPath(file: string): string {
  return file.split(path.sep).join("/");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Symbol scan aborted");
  }
}
