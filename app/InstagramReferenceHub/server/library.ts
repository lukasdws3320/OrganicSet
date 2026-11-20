import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export * from "./text";

export const SUBDIRS = ["database", "videos", "thumbnails", "exports", "backups"] as const;

export function libraryRoot(): string {
  return resolve(process.env.IRH_LIBRARY || join(import.meta.dir, "..", "library"));
}

export function ensureLibrary(root: string) {
  for (const d of SUBDIRS) mkdirSync(join(root, d), { recursive: true });
}

/** Resolve um caminho relativo à biblioteca sem deixar escapar dela. */
export function safeJoin(root: string, rel: string): string | null {
  const full = resolve(root, rel.replace(/^\/+/, ""));
  return full === root || full.startsWith(root + sep) ? full : null;
}
