import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { SymbolFileReadError, SymbolIndexWriteError, SymbolScanAbortedError } from "./errors.ts";
import { extractSymbolsFromSource } from "./symbols.ts";

import type { ScanSymbolsOptions, SymbolRecord } from "./types.ts";

const INDEX_SCHEMA_VERSION = 1;
const EXTRACTOR_VERSION = "symbols-v1";
const INDEX_FILENAME = "symbols.json";
const MAX_PROJECT_SLUG_PREFIX_LENGTH = 96;
const SYMBOL_KINDS = new Set<SymbolRecord["kind"]>([
  "class",
  "constant",
  "enum",
  "enum-member",
  "export",
  "function",
  "import",
  "interface",
  "method",
  "property",
  "type",
  "variable",
]);

interface CachedFile {
  hash: string;
  mtimeMs: number;
  size: number;
  symbols: SymbolRecord[];
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

export function getProjectIndexDirectory(projectRoot: string): string {
  return path.join(getTrufflerConfigRoot(), "projects", createProjectSlug(projectRoot));
}

function getTrufflerConfigRoot(): string {
  try {
    const home = homedir();

    if (home) {
      return path.join(home, ".truffler");
    }
  } catch {
    // Restricted runtimes can make home directory resolution unavailable.
  }

  return path.join(tmpdir(), ".truffler");
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
      isRecord(parsed.files)
    ) {
      return {
        schemaVersion: INDEX_SCHEMA_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        projectRoot,
        updatedAt:
          typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        files: sanitizeCachedFiles(parsed.files),
      };
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

function isFresh(cached: CachedFile, state: FileState): boolean {
  return cached.size === state.size && cached.mtimeMs === state.mtimeMs;
}

async function indexFile(
  file: string,
  state: FileState,
  cached: CachedFile | undefined,
): Promise<CachedFile> {
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
    const refreshed = {
      ...cached,
      mtimeMs: state.mtimeMs,
      size: state.size,
    };

    return refreshed;
  }

  const symbols = extractSymbolsFromSource(file, source);

  return {
    hash,
    mtimeMs: state.mtimeMs,
    size: state.size,
    symbols,
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
  index: ProjectIndex,
  currentRelativePaths: ReadonlySet<string>,
  updatedRelativePaths: ReadonlySet<string>,
): Promise<void> {
  await mkdir(location.directory, { recursive: true });

  const latestIndex = await readProjectIndex(location.file, index.projectRoot);
  const files: Record<string, CachedFile> = {};

  for (const relativePath of currentRelativePaths) {
    const cached = updatedRelativePaths.has(relativePath)
      ? index.files[relativePath]
      : (latestIndex.files[relativePath] ?? index.files[relativePath]);

    if (cached) {
      files[relativePath] = cached;
    }
  }

  const nextIndex: ProjectIndex = {
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

function hasStaleEntries(index: ProjectIndex, currentRelativePaths: ReadonlySet<string>): boolean {
  return Object.keys(index.files).some((relativePath) => !currentRelativePaths.has(relativePath));
}

function sanitizeCachedFiles(files: Record<string, unknown>): Record<string, CachedFile> {
  const sanitized: Record<string, CachedFile> = {};

  for (const [relativePath, value] of Object.entries(files)) {
    const cached = sanitizeCachedFile(value);

    if (cached) {
      sanitized[relativePath] = cached;
    }
  }

  return sanitized;
}

function sanitizeCachedFile(value: unknown): CachedFile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const symbols = Array.isArray(value.symbols)
    ? value.symbols.flatMap((symbol) => {
        const sanitized = sanitizeSymbolRecord(symbol);
        return sanitized ? [sanitized] : [];
      })
    : undefined;

  if (
    typeof value.hash !== "string" ||
    !isFiniteNumber(value.mtimeMs) ||
    !isFiniteNumber(value.size) ||
    !symbols
  ) {
    return undefined;
  }

  return {
    hash: value.hash,
    mtimeMs: value.mtimeMs,
    size: value.size,
    symbols,
  };
}

function sanitizeSymbolRecord(value: unknown): SymbolRecord | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !isSymbolKind(value.kind) ||
    typeof value.file !== "string" ||
    !isFiniteNumber(value.start) ||
    !isFiniteNumber(value.end)
  ) {
    return undefined;
  }

  return {
    name: value.name,
    kind: value.kind,
    file: value.file,
    start: value.start,
    end: value.end,
    ...pickOptionalNumber(value, "declarationStart"),
    ...pickOptionalNumber(value, "declarationEnd"),
    ...pickOptionalNumber(value, "line"),
    ...pickOptionalNumber(value, "column"),
    ...pickOptionalString(value, "container"),
    ...pickOptionalBoolean(value, "exported"),
    ...pickOptionalString(value, "signature"),
    ...pickOptionalNumber(value, "signatureStart"),
    ...pickOptionalNumber(value, "signatureEnd"),
    ...pickOptionalParameters(value),
    ...pickOptionalString(value, "returnType"),
    ...pickOptionalStringArray(value, "comments"),
    ...pickOptionalNumber(value, "commentStart"),
    ...pickOptionalNumber(value, "commentEnd"),
    ...pickOptionalString(value, "snippet"),
  };
}

function isSymbolKind(value: unknown): value is SymbolRecord["kind"] {
  return typeof value === "string" && SYMBOL_KINDS.has(value as SymbolRecord["kind"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pickOptionalNumber<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): Partial<Record<Key, number>> {
  return isFiniteNumber(value[key]) ? ({ [key]: value[key] } as Partial<Record<Key, number>>) : {};
}

function pickOptionalString<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): Partial<Record<Key, string>> {
  return typeof value[key] === "string"
    ? ({ [key]: value[key] } as Partial<Record<Key, string>>)
    : {};
}

function pickOptionalBoolean<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): Partial<Record<Key, boolean>> {
  return typeof value[key] === "boolean"
    ? ({ [key]: value[key] } as Partial<Record<Key, boolean>>)
    : {};
}

function pickOptionalStringArray<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): Partial<Record<Key, string[]>> {
  const candidate = value[key];

  return Array.isArray(candidate) && candidate.every((item) => typeof item === "string")
    ? ({ [key]: candidate } as Partial<Record<Key, string[]>>)
    : {};
}

function pickOptionalParameters(value: Record<string, unknown>): Partial<SymbolRecord> {
  const candidate = value.parameters;

  if (!Array.isArray(candidate)) {
    return {};
  }

  const parameters = candidate.flatMap((parameter) => {
    if (!isRecord(parameter) || typeof parameter.name !== "string") {
      return [];
    }

    return [
      {
        name: parameter.name,
        ...pickOptionalString(parameter, "type"),
        ...pickOptionalBoolean(parameter, "optional"),
        ...pickOptionalBoolean(parameter, "rest"),
        ...pickOptionalString(parameter, "default"),
      },
    ];
  });

  return { parameters };
}

function createProjectSlug(projectRoot: string): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const normalized = resolvedProjectRoot.split(path.sep).filter(Boolean).join("-");
  const safe = normalized
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_PROJECT_SLUG_PREFIX_LENGTH);
  const pathHash = createHash("sha256").update(resolvedProjectRoot).digest("hex").slice(0, 8);

  return `${safe || "root"}-${pathHash}`;
}

function toIndexPath(file: string): string {
  return file.split(path.sep).join("/");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SymbolScanAbortedError();
  }
}
