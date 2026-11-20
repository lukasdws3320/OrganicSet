// Prova os 9 critérios de aceite da ETAPA 13 contra o servidor real (processo separado),
// numa biblioteca temporária, com o downloader falso (sem rede). Imprime "ACEITE OK 9/9" só se todos passarem.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { BIN, run, sha256File } from "../server/importer";
import { FILE_NAME_RE } from "../server/library";

const ROOT_DIR = resolve(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "irh-aceite-"));
const lib = join(work, "Instagram Reference Hub");
const port = 4400 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;
let proc: ReturnType<typeof Bun.spawn> | null = null;

async function startServer() {
  proc = Bun.spawn([process.execPath, "run", join(ROOT_DIR, "server/index.ts")], {
    env: { ...process.env, IRH_LIBRARY: lib, IRH_PORT: String(port), IRH_DOWNLOADER: "fake" },
    stdout: "ignore", stderr: "inherit",
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/stats`)).ok) return;
    } catch { /* ainda subindo */ }
    await Bun.sleep(100);
  }
  throw new Error("servidor não subiu");
}

async function killServer() {
  proc?.kill("SIGKILL");
  await proc?.exited;
  proc = null;
}

async function api(path: string, init: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: init.json !== undefined ? { "Content-Type": "application/json" } : init.headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null;
  return { status: res.status, data, res };
}
const refsWhere = async (f: object) => (await api("/api/refs?f=" + encodeURIComponent(JSON.stringify(f)))).data.items.map((r: any) => r.id).sort();

async function upload(file: string, fields: Record<string, string>) {
  const fd = new FormData();
  fd.set("file", Bun.file(file), basename(file));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return api("/api/import/manual", { method: "POST", body: fd });
}

async function importLinks(urls: string[]) {
  const job = (await api("/api/import", { method: "POST", json: { urls } })).data;
  for (let i = 0; i < 300; i++) {
    const j = (await api(`/api/import/jobs/${job.id}`)).data;
    if (j.items.every((x: any) => !["pendente", "baixando"].includes(x.status))) return j.items as any[];
    await Bun.sleep(100);
  }
  throw new Error("lote não terminou");
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const results: { n: number; name: string; ok: boolean; detail: string }[] = [];
async function criterion(n: number, name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ n, name, ok: true, detail });
    console.log(`✓ ${n}. ${name} — ${detail}`);
  } catch (e: any) {
    results.push({ n, name, ok: false, detail: e?.message ?? String(e) });
    console.log(`✗ ${n}. ${name} — ${e?.message ?? e}`);
  }
}

const CAPTION = "🍎🍮 PUDIM FIT DE MAÇÃ!  😍\n\n📝 Ingredientes\n\n👩‍🍳 Modo de preparo\n1️⃣ Bata  bem.\n2️⃣ Asse a 200 °C.\n\n\n   recuo com espaços   \n👨‍👩‍👧‍👦 família 🇧🇷 #receitafit";

try {
  console.log(`Biblioteca temporária: ${lib}\nServidor: ${base} (downloader falso, sem rede)\n`);
  const clipA = join(work, "clipe-a.mp4");
  const clipB = join(work, "clipe-b.mp4");
  for (const [f, src] of [[clipA, "testsrc2"], [clipB, "smptebars"]]) {
    const r = await run([BIN.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", `${src}=s=360x640:d=3:r=24`, "-f", "lavfi", "-i", "sine=f=330:d=3",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", f]);
    assert(r.code === 0, `ffmpeg falhou: ${r.stderr}`);
  }
  await startServer();

  // Base: 1 upload manual + 3 importações por link (downloader falso).
  const up = await upload(clipA, { username: "@chef.teste", display_name: "Chef Teste", caption: CAPTION, likes: "5000", comments: "300", url: "https://www.instagram.com/reel/MANUAL0001/" });
  assert(up.status === 201, `upload manual falhou: ${JSON.stringify(up.data)}`);
  const A = up.data.id as string;
  const items = await importLinks(["https://www.instagram.com/p/AAAAA11111/", "https://www.instagram.com/reel/BBBBB22222/", "https://www.instagram.com/p/CCCCC33333/"]);
  const [B, C, D] = items.map((i) => i.ref_id as string);
  assert(B && C && D, "importação base falhou");

  await criterion(1, "Vídeo salvo reproduz sem internet (servidor local, HTTP Range 206)", async () => {
    const d = (await api(`/api/refs/${A}`)).data;
    const res = await fetch(`${base}/media/${d.video_path}`, { headers: { Range: "bytes=1000-1999" } });
    assert(res.status === 206, `status ${res.status}`);
    assert(res.headers.get("content-range")?.startsWith("bytes 1000-1999/"), "Content-Range ausente");
    const got = new Uint8Array(await res.arrayBuffer());
    const disk = new Uint8Array(await Bun.file(clipA).slice(1000, 2000).arrayBuffer());
    assert(got.length === 1000 && got.every((b, i) => b === disk[i]), "bytes servidos diferem do arquivo");
    const full = await fetch(`${base}/media/${d.video_path}`);
    assert(full.headers.get("content-type") === "video/mp4", "content-type não é video/mp4");
    return `206 Content-Range ${res.headers.get("content-range")}, bytes idênticos ao mp4 gerado por ffmpeg`;
  });

  let ana = 0, bia = 0;
  await criterion(2, "Referência relacionada a várias clientes", async () => {
    ana = (await api("/api/clients", { method: "POST", json: { name: "Ana Estética", segment: "Estética" } })).data.id;
    bia = (await api("/api/clients", { method: "POST", json: { name: "Bia Moda", segment: "Moda" } })).data.id;
    await api(`/api/refs/${A}`, { method: "PATCH", json: { clients: [ana, bia], categories: [1], status: "producao" } });
    const inAna = await refsWhere({ clients: [ana] });
    const inBia = await refsWhere({ clients: [bia] });
    assert(inAna.includes(A) && inBia.includes(A), "não aparece nas duas visões");
    const files = (await api(`/api/refs/${A}`)).data.video_path;
    assert(typeof files === "string", "sem arquivo");
    return `${A} aparece em Ana Estética e Bia Moda, com um único arquivo (${basename(files)})`;
  });

  await criterion(3, "Legenda preserva quebras de linha, emojis e espaços", async () => {
    const d = (await api(`/api/refs/${A}`)).data;
    const a = new TextEncoder().encode(CAPTION), b = new TextEncoder().encode(d.caption);
    assert(a.length === b.length && a.every((x, i) => x === b[i]), "legenda difere byte a byte");
    return `${a.length} bytes idênticos (👩‍🍳, 1️⃣, 👨‍👩‍👧‍👦, 🇧🇷, linhas em branco e recuos)`;
  });

  await criterion(4, "Filtros combinados (cliente + categoria + status + mín. curtidas + busca)", async () => {
    await api(`/api/refs/${B}`, { method: "PATCH", json: { clients: [ana], categories: [1], status: "disponivel" } });
    await api(`/api/refs/${C}`, { method: "PATCH", json: { clients: [bia], categories: [1], status: "producao" } });
    await api(`/api/refs/${D}`, { method: "PATCH", json: { clients: [ana], categories: [2], status: "producao" } });
    const full = { clients: [ana], categories: [1], status: ["producao"], minLikes: 1000, q: "maca" };
    const got = await refsWhere(full);
    assert(JSON.stringify(got) === JSON.stringify([A]), `esperado [${A}], veio ${JSON.stringify(got)}`);
    const checks: [object, string[]][] = [
      [{ clients: [ana] }, [A, B, D].sort()],
      [{ clients: [ana], categories: [1] }, [A, B].sort()],
      [{ clients: [ana], categories: [1], status: ["producao"] }, [A]],
      [{ categories: [1], status: ["producao"] }, [A, C].sort()],
      [{ ...full, minLikes: 999999 }, []],
      [{ ...full, q: "inexistentezzz" }, []],
    ];
    for (const [f, exp] of checks) {
      const r = await refsWhere(f);
      assert(JSON.stringify(r) === JSON.stringify(exp), `${JSON.stringify(f)} → ${JSON.stringify(r)} (esperado ${JSON.stringify(exp)})`);
    }
    return `combinação completa → [${A}]; 6 variações conferidas (busca "maca" acha "MAÇÃ")`;
  });

  const snapshot = async () => {
    const list = (await api("/api/refs?f=" + encodeURIComponent(JSON.stringify({ sort: "antigos" })))).data.items;
    return JSON.stringify(list.map((r: any) => [r.id, r.status, r.clients.map((c: any) => c.name), r.categories.map((c: any) => c.name), r.metrics?.likes]));
  };

  await criterion(5, "Dados persistem após fechar e reabrir (servidor morto com SIGKILL)", async () => {
    const before = await snapshot();
    await killServer();
    await startServer();
    const after = await snapshot();
    assert(before === after, `antes ${before} depois ${after}`);
    return `${JSON.parse(after).length} referências com status, clientes, categorias e métricas iguais após SIGKILL + reinício`;
  });

  await criterion(6, "Vídeos duplicados identificados (URL em variações + mesmo hash)", async () => {
    const variants = [
      "https://instagram.com/p/AAAAA11111",
      "https://www.instagram.com/reel/AAAAA11111/?igsh=MWx0",
      "https://www.instagram.com/perfil_teste/reels/AAAAA11111/",
      "https://www.instagram.com/tv/AAAAA11111#comentarios",
    ];
    const its = await importLinks(variants);
    assert(its[0].status === "duplicado" && its[0].ref_id === B, `1ª variação: ${its[0].status}`);
    assert(its.slice(1).every((i) => i.status === "duplicado"), "variações não marcadas como duplicado");
    const again = await upload(clipA, { username: "outra" });
    assert(again.status === 409 && again.data.existing === A, `upload repetido: ${again.status}`);
    const urlDup = await upload(clipB, { url: "https://www.instagram.com/reels/MANUAL0001/?x=1" });
    assert(urlDup.status === 409, "link duplicado no upload manual não detectado");
    const total = (await api("/api/stats")).data.total;
    assert(total === 4, `total mudou para ${total}`);
    return `4 variações de URL → duplicado de ${B}; mesmo arquivo → 409 (${A}); total continua 4`;
  });

  await criterion(7, "Arquivos localizáveis no computador com a nomenclatura padrão", async () => {
    const out: string[] = [];
    for (const id of [A, B, C, D]) {
      const d = (await api(`/api/refs/${id}`)).data;
      assert(d.abs_path && existsSync(d.abs_path), `${id}: arquivo não existe`);
      assert(d.abs_path.startsWith(join(lib, "videos") + "/"), `${id}: fora de videos/`);
      assert(/\/videos\/\d{4}\/\d{2}\/REF-/.test(d.abs_path), `${id}: sem pasta AAAA/MM`);
      assert(FILE_NAME_RE.test(basename(d.abs_path)) && basename(d.abs_path).startsWith(id + "_"), `${id}: nome fora do padrão (${basename(d.abs_path)})`);
      out.push(basename(d.abs_path));
    }
    return out.join(", ");
  });

  await criterion(8, "Importações com erro não comprometem os demais registros", async () => {
    const before = await snapshot();
    const its = await importLinks([
      "https://www.instagram.com/p/EEEEE55555/",
      "isto-nao-e-um-link",
      "https://www.instagram.com/explore/",
      "https://youtube.com/watch?v=abc",
      "https://www.instagram.com/reel/PRIVADO666/",
      "https://www.instagram.com/p/SUMIU77777/",
      "https://www.instagram.com/p/FFFFF88888/",
    ]);
    const st = its.map((i) => i.status);
    assert(st[0] === "ok" && st[6] === "ok", `válidos não importaram: ${st}`);
    assert(st.slice(1, 6).every((s) => s === "erro"), `inválidos não marcados como erro: ${st}`);
    assert(its.slice(1, 6).every((i) => i.error && i.error.length > 5), "erro sem motivo");
    const after = JSON.parse(await snapshot());
    const prev = JSON.parse(before);
    assert(JSON.stringify(after.slice(0, prev.length)) === before && after.length === prev.length + 2, "registros anteriores alterados");
    return `2 válidos importados, 5 erros com motivo (${its[4].error!.split(" —")[0]}), ${prev.length} anteriores intactos`;
  });

  await criterion(9, "Backup restaurado corretamente (apagar biblioteca → restaurar)", async () => {
    const coll = (await api("/api/collections", { method: "POST", json: { name: "Coleção de teste", refs: [A, C] } })).data;
    const before = await snapshot();
    const hashes: Record<string, string> = {};
    for (const id of JSON.parse(before).map((r: any) => r[0])) {
      const d = (await api(`/api/refs/${id}`)).data;
      hashes[id] = await sha256File(d.abs_path);
    }
    const b = (await api("/api/backup", { method: "POST" })).data;
    const saved = join(work, b.name);
    copyFileSync(join(lib, "backups", b.name), saved);
    await killServer();
    rmSync(lib, { recursive: true, force: true });
    await startServer();
    assert((await api("/api/stats")).data.total === 0, "biblioteca não foi apagada");
    const r = await api("/api/restore", { method: "POST", body: Bun.file(saved), headers: { "Content-Type": "application/zip" } });
    assert(r.status === 200, `restauração falhou: ${JSON.stringify(r.data)}`);
    const after = await snapshot();
    assert(after === before, "referências/relações diferentes após restaurar");
    for (const [id, h] of Object.entries(hashes)) {
      const d = (await api(`/api/refs/${id}`)).data;
      assert(d.file_exists && (await sha256File(d.abs_path)) === h, `${id}: hash diferente após restaurar`);
    }
    const members = await refsWhere({ collection: coll.id });
    assert(JSON.stringify(members) === JSON.stringify([A, C].sort()), "coleção não restaurada");
    return `${b.files} arquivos no backup; ${Object.keys(hashes).length} vídeos com SHA-256 iguais; clientes, categorias e coleção de volta`;
  });
} catch (e: any) {
  console.log(`Erro na preparação: ${e?.message ?? e}`);
} finally {
  await killServer();
  rmSync(work, { recursive: true, force: true });
}

const ok = results.filter((r) => r.ok).length;
console.log(ok === 9 && results.length === 9 ? "\nACEITE OK 9/9" : `\nACEITE FALHOU ${ok}/9`);
process.exit(ok === 9 ? 0 : 1);
