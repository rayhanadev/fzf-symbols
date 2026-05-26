import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { SymbolFileReadError, SymbolIndexWriteError, SymbolScanAbortedError } from "../errors.ts";
import { extractSymbolsFromSource } from "../symbols.ts";
import type { ScanSymbolsOptions, SymbolRecord } from "../types.ts";
import { INDEX_FILENAME } from "./constants.ts";
import { getProjectIndexDirectory, getProjectIndexLocation, toIndexPath } from "./paths.ts";
import { createEmptyV1ProjectIndex, parseV1ProjectIndex } from "./schema.ts";
import type { ProjectIndexLocation, V1CachedFile, V1ProjectIndex } from "./types.ts";

export { getProjectIndexDirectory };

interface FileState {
  mtimeMs: number;
  size: number;
}

export async function scanSymbolsWithIndex(
  files: readonly string[],
  options: ScanSymbolsOptions,
): Promise<SymbolRecord[]> {
  const projectRoot = await getProjectRoot(options);
  const location = getProjectIndexLocation(projectRoot);
  const index = await readProjectIndex(location.file, projectRoot);
  const symbols: SymbolRecord[] = [];
  const allowedKinds = options.symbolKinds ? new Set(options.symbolKinds) : undefined;
  const currentRelativePaths = new Set(
    files.map((file) => toIndexPath(path.relative(projectRoot, file))),
  );
  const updatedRelativePaths = new Set<string>();
  let indexChanged = false;

  for (const file of files) {
    throwIfAborted(options.signal);

    const relativePath = toIndexPath(path.relative(projectRoot, file));
    const cached = index.files[relativePath];
    const state = await readFileState(file);

    if (cached && isFresh(cached, state)) {
      appendSymbols(symbols, cached.symbols, allowedKinds);
      continue;
    }

    const indexed = await indexFile(file, state, cached);

    index.files[relativePath] = indexed;
    updatedRelativePaths.add(relativePath);
    indexChanged = true;
    appendSymbols(symbols, indexed.symbols, allowedKinds);
  }

  if (indexChanged || hasStaleEntries(index, currentRelativePaths)) {
    index.updatedAt = new Date().toISOString();
    try {
      await writeProjectIndex(location, index, currentRelativePaths, updatedRelativePaths);
    } catch (cause) {
      throw new SymbolIndexWriteError(
        location.file,
        cause instanceof Error ? cause.message : "Failed to write symbol index",
        { cause },
      );
    }
  }

  return symbols;
}

async function getProjectRoot(options: ScanSymbolsOptions): Promise<string> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const root = path.resolve(cwd, options.root ?? ".");

  try {
    const info = await stat(root);
    return info.isFile() ? path.dirname(root) : root;
  } catch {
    return root;
  }
}

async function readProjectIndex(file: string, projectRoot: string): Promise<V1ProjectIndex> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = parseV1ProjectIndex(JSON.parse(raw), projectRoot);

    if (parsed) {
      return parsed;
    }
  } catch {
    // A missing or unreadable index should never block a symbol scan.
  }

  // No migrations exist yet; incompatible cache versions are rebuilt from source.
  return createEmptyV1ProjectIndex(projectRoot);
}

async function readFileState(file: string): Promise<FileState> {
  try {
    const info = await stat(file);

    return {
      mtimeMs: info.mtimeMs,
      size: info.size,
    };
  } catch (cause) {
    throw new SymbolFileReadError(
      file,
      cause instanceof Error ? cause.message : "Failed to stat file",
      { cause },
    );
  }
}

function isFresh(cached: V1CachedFile, state: FileState): boolean {
  return cached.size === state.size && cached.mtimeMs === state.mtimeMs;
}

async function indexFile(
  file: string,
  state: FileState,
  cached: V1CachedFile | undefined,
): Promise<V1CachedFile> {
  let source: string;

  try {
    source = await readFile(file, "utf8");
  } catch (cause) {
    throw new SymbolFileReadError(
      file,
      cause instanceof Error ? cause.message : "Failed to read file",
      { cause },
    );
  }

  const hash = createContentHash(source);

  if (cached?.hash === hash) {
    return {
      ...cached,
      mtimeMs: state.mtimeMs,
      size: state.size,
    };
  }

  return {
    hash,
    mtimeMs: state.mtimeMs,
    size: state.size,
    symbols: extractSymbolsFromSource(file, source),
  };
}

function appendSymbols(
  target: SymbolRecord[],
  symbols: readonly SymbolRecord[],
  allowedKinds: Set<SymbolRecord["kind"]> | undefined,
): void {
  if (!allowedKinds) {
    target.push(...symbols);
    return;
  }

  for (const symbol of symbols) {
    if (allowedKinds.has(symbol.kind)) {
      target.push(symbol);
    }
  }
}

function createContentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function writeProjectIndex(
  location: ProjectIndexLocation,
  index: V1ProjectIndex,
  currentRelativePaths: ReadonlySet<string>,
  updatedRelativePaths: ReadonlySet<string>,
): Promise<void> {
  await mkdir(location.directory, { recursive: true });

  const latestIndex = await readProjectIndex(location.file, index.projectRoot);
  const files: Record<string, V1CachedFile> = {};

  for (const relativePath of currentRelativePaths) {
    const cached = updatedRelativePaths.has(relativePath)
      ? index.files[relativePath]
      : (latestIndex.files[relativePath] ?? index.files[relativePath]);

    if (cached) {
      files[relativePath] = cached;
    }
  }

  const nextIndex: V1ProjectIndex = {
    ...index,
    updatedAt: new Date().toISOString(),
    files,
  };

  const temporaryFile = path.join(
    location.directory,
    `${INDEX_FILENAME}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  await writeFile(temporaryFile, `${JSON.stringify(nextIndex)}\n`, "utf8");
  await rename(temporaryFile, location.file);
}

function hasStaleEntries(
  index: V1ProjectIndex,
  currentRelativePaths: ReadonlySet<string>,
): boolean {
  return Object.keys(index.files).some((relativePath) => !currentRelativePaths.has(relativePath));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SymbolScanAbortedError();
  }
}
