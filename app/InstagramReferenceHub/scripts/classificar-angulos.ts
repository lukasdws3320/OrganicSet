// Classifica ângulos em lote (transcreve o que faltar). Uso:
//   bun scripts/classificar-angulos.ts                 → só os que ainda não têm análise (ou deram erro)
//   bun scripts/classificar-angulos.ts --refazer       → todos os vídeos
//   bun scripts/classificar-angulos.ts REF-2026-10-0001 REF-…   → só estes
//   --concorrencia 3 (padrão)
import { analisarAngulos } from "../server/angulos";
import { openDb } from "../server/db";
import { libraryRoot } from "../server/library";

const args = process.argv.slice(2);
const refazer = args.includes("--refazer");
const ci = args.indexOf("--concorrencia");
const conc = ci >= 0 ? Math.max(1, Number(args[ci + 1])) : 3;
const root = libraryRoot();
const db = openDb(root);
const pedidos = args.filter((a) => /^REF-/.test(a));
const refs = pedidos.length ? pedidos : (db.query(`SELECT id FROM refs WHERE kind = 'video' AND video_path IS NOT NULL
  ${refazer ? "" : "AND (angulo_analise IS NULL OR json_extract(angulo_analise, '$.status') = 'erro')"} ORDER BY id`).all() as { id: string }[]).map((r) => r.id);
console.log(`${refs.length} referência(s), concorrência ${conc}`);
let i = 0, ok = 0, erro = 0;
await Promise.all(Array.from({ length: conc }, async () => {
  while (i < refs.length) {
    const ref = refs[i++];
    const a = await analisarAngulos({ db, root }, ref);
    if (a.status === "ok") ok++; else erro++;
    console.log(`${ref} ${a.status === "ok" ? `hook=[${a.hook?.angulos.join(", ")}] corpo=[${a.corpo?.angulos.join(", ")}] (${a.transcricao})` : `ERRO ${a.erro}`}`);
  }
}));
console.log(`fim: ${ok} ok, ${erro} erro`);
