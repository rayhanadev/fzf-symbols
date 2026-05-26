import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { INDEX_FILENAME } from "./constants.ts";
import type { ProjectIndexLocation } from "./types.ts";

const MAX_PROJECT_SLUG_PREFIX_LENGTH = 96;

export function getProjectIndexDirectory(projectRoot: string): string {
  return path.join(getTrufflerConfigRoot(), "projects", createProjectSlug(projectRoot));
}

export function getProjectIndexLocation(projectRoot: string): ProjectIndexLocation {
  const directory = getProjectIndexDirectory(projectRoot);

  return {
    directory,
    file: path.join(directory, INDEX_FILENAME),
  };
}

export function toIndexPath(file: string): string {
  return file.split(path.sep).join("/");
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
