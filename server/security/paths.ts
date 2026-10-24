import path from "node:path";

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const SAFE_ID = /^[a-z0-9_-]{6,64}$/i;

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

export function assertSafeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new UnsafePathError(`Invalid identifier: ${JSON.stringify(id).slice(0, 80)}`);
  return id;
}

/**
 * Resolve a mission-relative file path inside the mission directory. Allows one optional
 * subdirectory segment (e.g. "sources/abc.txt") and rejects traversal, absolute paths and odd names.
 */
export function resolveInside(root: string, relative: string): string {
  if (typeof relative !== "string" || relative.length === 0 || relative.length > 200) {
    throw new UnsafePathError("Empty or oversized path");
  }
  if (path.isAbsolute(relative) || relative.includes("\\") || relative.includes("\0")) {
    throw new UnsafePathError("Absolute or malformed paths are not permitted");
  }
  const parts = relative.split("/");
  if (parts.length > 2 || parts.some((p) => !SAFE_NAME.test(p) || p === "." || p === "..")) {
    throw new UnsafePathError(`Unsafe path segment in ${JSON.stringify(relative)}`);
  }
  const base = path.resolve(root);
  const full = path.resolve(base, relative);
  if (!full.startsWith(base + path.sep)) throw new UnsafePathError("Path escapes the artifact directory");
  return full;
}
