import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { SymbolScanAbortedError } from "./errors.ts";

import type { FileDiscoveryOptions } from "./types.ts";

const DEFAULT_EXTENSIONS = [
  ".cjs",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
] as const;

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

interface PathMatcher {
  kind: "basename" | "extension" | "path" | "regex";
  value: string;
  regex?: RegExp;
}

interface WalkContext {
  cwd: string;
  extensions: Set<string>;
  include: readonly PathMatcher[];
  exclude: readonly PathMatcher[];
  files: string[];
  signal?: AbortSignal;
}

export async function discoverFiles(options: FileDiscoveryOptions = {}): Promise<string[]> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const root = path.resolve(cwd, options.root ?? ".");
  const context: WalkContext = {
    cwd,
    extensions: new Set(options.extensions ?? DEFAULT_EXTENSIONS),
    include: createMatchers(options.include),
    exclude: createMatchers(options.exclude),
    files: [],
    signal: options.signal,
  };
  const rootInfo = await stat(root);

  throwIfAborted(options.signal);

  if (rootInfo.isFile()) {
    if (shouldIncludeFile(root, context)) {
      context.files.push(root);
    }

    return context.files;
  }

  await walkDirectory(root, context);
  context.files.sort();
  return context.files;
}

async function walkDirectory(directory: string, context: WalkContext): Promise<void> {
  throwIfAborted(context.signal);

  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    throwIfAborted(context.signal);

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        DEFAULT_IGNORED_DIRECTORIES.has(entry.name) ||
        matchesAny(toRelativePath(absolutePath, context.cwd), entry.name, "", context.exclude)
      ) {
        continue;
      }

      await walkDirectory(absolutePath, context);
      continue;
    }

    if (entry.isFile() && shouldIncludeFile(absolutePath, context)) {
      context.files.push(absolutePath);
    }
  }
}

function shouldIncludeFile(file: string, context: WalkContext): boolean {
  const extension = getSourceExtension(file);

  if (!context.extensions.has(extension)) {
    return false;
  }

  const relativePath = toRelativePath(file, context.cwd);
  const basename = path.basename(file);

  if (matchesAny(relativePath, basename, extension, context.exclude)) {
    return false;
  }

  return (
    context.include.length === 0 || matchesAny(relativePath, basename, extension, context.include)
  );
}

function getSourceExtension(file: string): string {
  if (file.endsWith(".d.ts")) {
    return ".d.ts";
  }

  return path.extname(file);
}

function createMatchers(patterns: readonly string[] | undefined): PathMatcher[] {
  if (!patterns) {
    return [];
  }

  return patterns.map((pattern) => {
    if (pattern.startsWith(".") && !pattern.includes("*")) {
      return { kind: "extension", value: pattern };
    }

    if (pattern.includes("*") || pattern.includes("?")) {
      return {
        kind: "regex",
        value: pattern,
        regex: globToRegExp(normalizePath(pattern)),
      };
    }

    if (pattern.includes("/")) {
      return { kind: "path", value: normalizePath(pattern) };
    }

    return { kind: "basename", value: pattern };
  });
}

function matchesAny(
  relativePath: string,
  basename: string,
  extension: string,
  matchers: readonly PathMatcher[],
): boolean {
  return matchers.some((matcher) => {
    switch (matcher.kind) {
      case "basename":
        return matcher.value === basename || relativePath.includes(matcher.value);
      case "extension":
        return matcher.value === extension;
      case "path":
        return relativePath === matcher.value || relativePath.includes(matcher.value);
      case "regex":
        return matcher.regex?.test(relativePath) ?? false;
    }
  });
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", ".")
    .replaceAll("\0", ".*");

  return new RegExp(`^${source}$`);
}

function toRelativePath(file: string, cwd: string): string {
  return normalizePath(path.relative(cwd, file));
}

function normalizePath(file: string): string {
  return file.split(path.sep).join("/");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SymbolScanAbortedError();
  }
}
