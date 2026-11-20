import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Preparation } from "./replication-preparation-state";

export const preparationFile = (root: string, ref: string, slug: string | null) => join(root, "replicacoes", ref, ...(slug ? [slug] : []), "preparacao.json");
export function readPreparation(root: string, ref: string, slug: string | null): Preparation | null {
  const file = preparationFile(root, ref, slug);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
