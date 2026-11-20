import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { routeReplication } from "../server/replication-routing";

// Local-only lookup. Does not import the database, mutate the job or drive a browser.
try {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { replication: { type: "string" }, version: { type: "string" } } });
  if (!values.replication || !isAbsolute(values.replication)) throw Error("Use --replication /caminho/absoluto/replicacao.json [--version V1]");
  const route = routeReplication(JSON.parse(readFileSync(values.replication, "utf8")), values.version);
  const skillRoot=resolve(import.meta.dir,"../.claude/skills/replicar-referencia");
  console.log(JSON.stringify({ ...route, formatModulePath: resolve(skillRoot,route.formatModule), productionModulePaths:Object.fromEntries(Object.entries(route.productionModules).map(([name,path])=>[name,resolve(skillRoot,path)])), modified: false, generationSubmitted: false }, null, 2));
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
