import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { DB_FILE, now } from "./db";
import { run, sha256File } from "./importer";
import { safeJoin, slugify } from "./library";
import { getRef, HttpError, listRefs, type Ctx } from "./refs";
import { ANALYSIS_FIELDS, STATUS_LABEL, type Filters, type RefDetail } from "./types";

// ---------- planilha ----------

const COLUMNS: [string, (r: RefDetail) => string | number | null][] = [
  ["ID", (r) => r.id],
  ["Link original", (r) => r.url],
  ["@usuário", (r) => r.username],
  ["Nome do perfil", (r) => r.display_name],
  ["Tipo", (r) => r.kind],
  ["Status", (r) => STATUS_LABEL[r.status]],
  ["Favorito", (r) => (r.favorite ? "sim" : "não")],
  ["Publicado em", (r) => r.published_at],
  ["Importado em", (r) => r.imported_at],
  ["Visualizações", (r) => r.metrics?.views ?? null],
  ["Curtidas", (r) => r.metrics?.likes ?? null],
  ["Comentários", (r) => r.metrics?.comments ?? null],
  ["Métricas coletadas em", (r) => r.metrics?.collected_at ?? null],
  ["Fonte das métricas", (r) => r.metrics?.source ?? null],
  ["Engajamento (%)", (r) => (r.engagement == null ? null : Number(r.engagement.toFixed(2)))],
  ["Categorias", (r) => r.categories.map((c) => c.name).join(", ")],
  ["Clientes", (r) => r.clients.map((c) => c.name).join(", ")],
  ["Projetos", (r) => r.projects.map((c) => c.name).join(", ")],
  ["Tags", (r) => r.tags.map((c) => c.name).join(", ")],
  ["CTA da legenda", (r) => r.cta_keyword],
  ["Duração (s)", (r) => (r.duration == null ? null : Number(r.duration.toFixed(2)))],
  ["Cortes detectados", (r) => r.cuts],
  ["Arquivo", (r) => r.video_path ?? r.thumb_path],
  ["SHA-256", (r) => r.file_hash],
  ["Legenda", (r) => r.caption],
  ["Notas", (r) => r.notes],
  ...ANALYSIS_FIELDS.map(([k, label]) => [label, (r: RefDetail) => r[k]] as [string, (r: RefDetail) => string]),
];

function rowsFor(ctx: Ctx, f: Filters) {
  return listRefs(ctx, f).items.map((c) => getRef(ctx, c.id)!);
}

export function toCsv(refs: RefDetail[]): string {
  const cell = (v: string | number | null) => {
    if (v == null) return "";
    const s = String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [COLUMNS.map(([h]) => cell(h)).join(";"), ...refs.map((r) => COLUMNS.map(([, fn]) => cell(fn(r))).join(";"))];
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM + ";" = abre certo no Excel em PT-BR
}

export const exportCsv = (ctx: Ctx, f: Filters) => toCsv(rowsFor(ctx, f));

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function exportXlsx(ctx: Ctx, f: Filters): Promise<string> {
  const refs = rowsFor(ctx, f);
  const cell = (v: string | number | null) =>
    v == null ? "<c/>" : typeof v === "number" ? `<c t="n"><v>${v}</v></c>` : `<c t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const rows = [COLUMNS.map(([h]) => cell(h)), ...refs.map((r) => COLUMNS.map(([, fn]) => cell(fn(r))))].map((c) => `<row>${c.join("")}</row>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Referências" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
  };
  const stage = tmpDir(ctx.root, "xlsx-");
  try {
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(stage, p, ".."), { recursive: true });
      writeFileSync(join(stage, p), c);
    }
    const out = join(ctx.root, "exports", `referencias-${stamp()}.xlsx`);
    await zip(stage, out, ["[Content_Types].xml", "_rels", "xl"], false);
    return out;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// ---------- zip ----------

function tmpDir(root: string, prefix: string) {
  mkdirSync(join(root, ".tmp"), { recursive: true });
  return mkdtempSync(join(root, ".tmp", prefix));
}

export const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function zip(cwd: string, out: string, entries: string[], store = true) {
  const present = entries.filter((e) => existsSync(join(cwd, e)));
  if (!present.length) return;
  const p = Bun.spawn(["zip", "-q", "-r", "-X", "-D", ...(store ? ["-0"] : []), out, ...present], { cwd, stdout: "ignore", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(`zip falhou: ${err.trim()}`);
}

function walk(dir: string, base: string, out: string[] = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push(relative(base, full));
  }
  return out;
}

function linkOrCopy(from: string, to: string) {
  mkdirSync(join(to, ".."), { recursive: true });
  try { linkSync(from, to); } catch { copyFileSync(from, to); }
}

// ---------- exportar coleção ----------

export async function exportCollection(ctx: Ctx, id: number): Promise<string> {
  const c = ctx.db.query("SELECT name FROM collections WHERE id = ?").get(id) as any;
  if (!c) throw new HttpError(404, "Coleção não encontrada");
  const refs = rowsFor(ctx, { collection: id, sort: "recentes" });
  const stage = tmpDir(ctx.root, "col-");
  try {
    for (const r of refs) {
      for (const [p, dir] of [[r.video_path, "videos"], [r.thumb_path, "capas"]] as const) {
        const abs = p && safeJoin(ctx.root, p);
        if (abs && existsSync(abs)) linkOrCopy(abs, join(stage, dir, basename(abs)));
      }
    }
    writeFileSync(join(stage, "metadados.csv"), toCsv(refs));
    writeFileSync(join(stage, "metadados.json"), JSON.stringify({ colecao: c.name, exportado_em: now(), referencias: refs }, null, 2));
    const out = join(ctx.root, "exports", `colecao-${slugify(c.name, "colecao")}-${stamp()}.zip`);
    await zip(stage, out, ["metadados.csv", "metadados.json", "videos", "capas"]);
    return out;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// ---------- backup e restauração ----------

interface Manifest {
  app: "instagram-reference-hub";
  format: 1;
  created_at: string;
  refs: number;
  files: { path: string; size: number; sha256: string }[];
}

export async function createBackup(ctx: Ctx) {
  const stage = tmpDir(ctx.root, "bkp-");
  try {
    mkdirSync(join(stage, "database"), { recursive: true });
    const snap = join(stage, DB_FILE);
    ctx.db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    const files: Manifest["files"] = [{ path: DB_FILE, size: statSync(snap).size, sha256: await sha256File(snap) }];
    for (const rel of [...walk(join(ctx.root, "videos"), ctx.root), ...walk(join(ctx.root, "thumbnails"), ctx.root), ...walk(join(ctx.root, "funis"), ctx.root), ...walk(join(ctx.root, "perfis"), ctx.root)]) {
      const abs = join(ctx.root, rel);
      files.push({ path: rel, size: statSync(abs).size, sha256: await sha256File(abs) });
    }
    const manifest: Manifest = {
      app: "instagram-reference-hub", format: 1, created_at: now(),
      refs: (ctx.db.query("SELECT count(*) n FROM refs").get() as any).n, files,
    };
    writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
    const name = `backup-${stamp()}.zip`;
    const out = join(ctx.root, "backups", name);
    await zip(stage, out, ["manifest.json", "database"]);
    await zip(ctx.root, out, ["videos", "thumbnails", ...["funis", "perfis"].filter((d) => existsSync(join(ctx.root, d)))]);
    return { name, size: statSync(out).size, files: files.length, refs: manifest.refs, created_at: manifest.created_at };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function listBackups(root: string) {
  const dir = join(root, "backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".zip")).map((name) => {
    const s = statSync(join(dir, name));
    return { name, size: s.size, created_at: s.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

const RESTORABLE = ["database", "videos", "thumbnails", "funis", "perfis"];
/** Backups antigos não têm funis/ nem perfis/: nesse caso a pasta atual fica onde está (não vai para o lado). */
const OPCIONAL = new Set(["funis", "perfis"]);

/**
 * Restaura um backup zip. Valida manifesto, hashes e integridade do SQLite ANTES de tocar na biblioteca.
 * A biblioteca atual é movida para backups/antes-da-restauracao-<data>/, nunca apagada.
 * `swap` fecha o banco atual, executa a troca e reabre.
 */
export async function restoreBackup(root: string, zipPath: string, swap: (doMove: () => void) => void) {
  const stage = tmpDir(root, "rst-");
  try {
    const u = await run(["unzip", "-q", "-o", zipPath, "-d", stage], 1_800_000);
    if (u.code !== 0) throw new HttpError(400, `Arquivo de backup ilegível: ${u.stderr.trim().slice(0, 200)}`);
    const mf = join(stage, "manifest.json");
    if (!existsSync(mf)) throw new HttpError(400, "Backup sem manifest.json — não foi gerado por este app");
    const manifest = JSON.parse(await Bun.file(mf).text()) as Manifest;
    if (manifest.app !== "instagram-reference-hub" || !Array.isArray(manifest.files)) throw new HttpError(400, "Manifesto de backup inválido");
    for (const f of manifest.files) {
      const abs = safeJoin(stage, f.path);
      if (!abs || !RESTORABLE.includes(f.path.split("/")[0])) throw new HttpError(400, `Caminho inválido no backup: ${f.path}`);
      if (!existsSync(abs)) throw new HttpError(400, `Arquivo ausente no backup: ${f.path}`);
      if (statSync(abs).size !== f.size || (await sha256File(abs)) !== f.sha256) throw new HttpError(400, `Hash não confere: ${f.path}`);
    }
    const check = new Database(join(stage, DB_FILE), { readonly: true });
    const ok = (check.query("PRAGMA integrity_check").get() as any)?.integrity_check;
    check.close();
    if (ok !== "ok") throw new HttpError(400, `Banco do backup corrompido: ${ok}`);

    const aside = join(root, "backups", `antes-da-restauracao-${stamp()}`);
    swap(() => {
      mkdirSync(aside, { recursive: true });
      for (const d of RESTORABLE) {
        if (OPCIONAL.has(d) && !existsSync(join(stage, d))) continue;
        if (existsSync(join(root, d))) renameSync(join(root, d), join(aside, d));
        if (existsSync(join(stage, d))) renameSync(join(stage, d), join(root, d));
        else mkdirSync(join(root, d), { recursive: true });
      }
    });
    return { restored_files: manifest.files.length, refs: manifest.refs, backup_created_at: manifest.created_at, previous_saved_to: relative(root, aside) };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

// ---------- espaço em disco ----------

export function storage(root: string) {
  const size = (d: string) => walk(join(root, d), root).reduce((a, f) => a + statSync(join(root, f)).size, 0);
  const parts = Object.fromEntries(["videos", "thumbnails", "database", "exports", "backups"].map((d) => [d, size(d)]));
  let free: number | null = null;
  try {
    const s = statfsSync(root);
    free = s.bavail * s.bsize;
  } catch { /* sem statfs: deixa como não disponível */ }
  return { root, parts, total: Object.values(parts).reduce((a, b) => a + b, 0), free };
}
