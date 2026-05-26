import { type as arkType } from "arktype";

import { V1_EXTRACTOR_VERSION, V1_INDEX_SCHEMA_VERSION } from "./constants.ts";
import type { V1CachedFile, V1ProjectIndex } from "./types.ts";

const V1ProjectIndexSchema = arkType({
  schemaVersion: "number",
  extractorVersion: "string",
  projectRoot: "string",
  updatedAt: "string",
  files: "object",
});

export function parseV1ProjectIndex(
  value: unknown,
  projectRoot: string,
): V1ProjectIndex | undefined {
  const parsed = V1ProjectIndexSchema(value);

  if (
    parsed instanceof arkType.errors ||
    parsed.schemaVersion !== V1_INDEX_SCHEMA_VERSION ||
    parsed.extractorVersion !== V1_EXTRACTOR_VERSION ||
    parsed.projectRoot !== projectRoot
  ) {
    return undefined;
  }

  return {
    schemaVersion: V1_INDEX_SCHEMA_VERSION,
    extractorVersion: V1_EXTRACTOR_VERSION,
    projectRoot,
    updatedAt: parsed.updatedAt,
    files: Array.isArray(parsed.files) ? {} : (parsed.files as Record<string, V1CachedFile>),
  };
}

export function createEmptyV1ProjectIndex(projectRoot: string): V1ProjectIndex {
  return {
    schemaVersion: V1_INDEX_SCHEMA_VERSION,
    extractorVersion: V1_EXTRACTOR_VERSION,
    projectRoot,
    updatedAt: new Date().toISOString(),
    files: {},
  };
}
