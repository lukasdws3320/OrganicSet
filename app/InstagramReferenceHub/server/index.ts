import { montarFilaPostagem } from './posting-queue';
import { abrirNoSistema } from './abrir';
import { lerPostsVault } from './posts';
import { refreshPublication } from './replication-publication';
import { executionContext, prepareChatPackage, listChatPackages, chatPackageZip } from './execution';
import {ProductionService} from './production-service';
import {withActor} from './production-workflow';
import { arquivoVideoProprio, atualizarPost, criarPost, geridoPelaNota, listarPosts } from './posts';
import { agendaConfig, agendarAutomatico } from './agenda';
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { abrirTarefasDb, inicializarTarefasFixture, resolverFonteTarefas, TarefaErro, validarTarefasDb } from "./tarefas-db";
import { createBackup, exportCollection, exportCsv, exportXlsx, listBackups, restoreBackup, stamp, storage } from "./archive";
import { analisarAngulos, FilaAngulos } from "./angulos";
import * as cat from "./catalog";
import { ensureClientSlugs, ensureProfiles, now, openDb } from "./db";
import { invalidatePipeline, listPipeline, listProfiles, patchPipeline, pipelineSnapshot, syncPipeline } from "./pipeline";
import { fakeDownloader } from "./fake-downloader";
import { Importer, ytdlp, type Assign, type Downloader } from "./importer";
import { ensureLibrary, extractUrls, libraryRoot, safeJoin } from "./library";
import type { FinderOptions } from "./pacote-frames";
import { prepararFramesReplicacao, revelarFramesReplicacao, configurarReplicacao, analisarRef, importarAnalise, criarReplicacao, getReplicacao, listReplicacoes, markdownReplicacao, segmentarRef, setStatus, arquivarReplicacao } from "./replicacoes";
import { syncReplicationExperts } from "./replication-assignments";
import { ReplicationPreparation, type PreparationTasks } from "./replication-preparation";
import { listarPrompts, marcarFavorito, registrarUso } from "./prompts";
import { adicionarPerfil, atualizarPerfil, fichaPost, listarPerfis, obterPerfil, removerPerfil } from "./perfis";
import {
  apagarFunil, apagarSwipe, atualizarSwipe, criarFunil, criarSwipe, duplicarFunil, ensureFunis, gravarImagemSwipe, imagemSwipe,
  listarFunis, listarSwipes, obterFunil, paginasVault, postsProduzidos, paginaVault, salvarFunil, servirVault, vaultAbs, vaultImagem, vaultPorRaizRecente,
} from "./funis";
import { flowProduction, flowProductionMedia, flowEditedVideo } from "./flow-production";
import { apagarTarefa, criarTarefa, editarTarefa, idTarefa, listarTarefas, opcoesTarefas, sincronizarAgenda } from "./tarefas";
import { arquivoCarrossel, listarCarrosseis, obterCarrossel, registrarPerfisVault } from "./perfis-vault";
import { deleteRef, duplicateGroups, getRef, HttpError, listRefs, refreshCtaKeywords, updateRef, type Ctx } from "./refs";
import type { Filters } from "./types";

const WEB_DIST = resolve(import.meta.dir, "..", "web", "dist");

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
  ".json": "application/json", ".zip": "application/zip", ".csv": "text/csv; charset=utf-8", ".ico": "image/x-icon",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const json = (data: unknown, status = 200) => Response.json(data, { status });

function decodePath(pathname: string): string | null {
  try { return decodeURIComponent(pathname); } catch { return null; }
}

function isFile(abs: string) {
  try { return statSync(abs).isFile(); } catch { return false; }
}

/** Serve arquivo com suporte a HTTP Range (necessário para o <video> pular no tempo). */
function serveFile(req: Request, abs: string, download?: string): Response {
  const file = Bun.file(abs);
  const size = file.size;
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
    // Sem isto o navegador baixa de novo cada capa a cada tela; com isto, confirma em 304 e usa a que já tem.
    ETag: `"${size.toString(36)}-${Math.trunc(file.lastModified).toString(36)}"`,
  };
  if (!req.headers.get("range") && req.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers: { ETag: headers.ETag, "Cache-Control": "no-cache" } });
  if (download) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(download)}`;
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(file, { headers: { ...headers, "Content-Length": String(size) } });
}

function parseFilters(url: URL): Filters {
  const raw = url.searchParams.get("f");
  let out: Filters = {};
  if (raw) {
    try {
      const j = JSON.parse(raw);
      out = { ...cat.cleanFilters(j), collection: Number(j.collection) || undefined };
    } catch {
      throw new HttpError(400, "Filtro inválido");
    }
  }
  return { ...out, ...queryFilters(url) };
}

/** Filtros também por query string (GET /api/refs?stage=pronta,postada&profile=bruno-goytacaz&facet.formato=1,2&sem_criador=1). */
function queryFilters(url: URL): Filters {
  const sp = url.searchParams;
  const list = (k: string) => sp.getAll(k).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  const f: Filters = {};
  if (list("kind").length) f.kind = list("kind") as Filters["kind"];
  if (list("stage").length) f.stage = list("stage") as Filters["stage"];
  if (list("origem").length) f.origem = list("origem") as Filters["origem"];
  if (sp.get("profile")) f.profile = sp.get("profile")!;
  if (sp.get("sem_criador") === "1" || sp.get("sem_criador") === "true") f.sem_criador = true;
  for (const key of new Set([...sp.keys()].filter((k) => k.startsWith("facet.")))) {
    const vals = list(key).map(Number).filter(Number.isInteger);
    if (vals.length) (f.facets ??= {})[key.slice("facet.".length)] = vals;
  }
  return f;
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

function parseAssign(b: any): Assign | undefined {
  const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : undefined);
  const a: Assign = { clients: nums(b?.clients), categories: nums(b?.categories), collection: Number(b?.collection) || undefined };
  if (b?.notes && typeof b.notes === "object") a.notes = Object.fromEntries(Object.entries(b.notes).map(([k, v]) => [k, String(v).slice(0, 5000)]));
  return a.clients?.length || a.categories?.length || a.collection || a.notes ? a : undefined;
}

type Handler = (req: Request, p: string[], url: URL) => Response | Promise<Response>;

export function startServer(opts: { root?: string; port?: number; downloader?: Downloader; dev?: boolean; finder?: FinderOptions; replicationPreparation?: Partial<PreparationTasks>; tarefasDb?: string; resumeOnBoot?: boolean } = {}) {
  const root = opts.root ?? libraryRoot();
  // Tarefas: fonte canônica fora da biblioteca. Produção = registro de fontes do vault (abre só banco já inicializado;
  // ausente/inválido = rotas de tarefas respondem 503, o resto do Hub sobe). Root injetado (testes) = fixture explícita
  // em <root>/gestao/, fora das pastas que o restore de backup move — restaurar a biblioteca não volta tarefas no tempo.
  const tarefasFixture = opts.tarefasDb ?? (opts.root ? join(root, "gestao", "tarefas.sqlite") : null);
  let tarefasDb: Database | null = null;
  const tarefas = (): Database => {
    if (tarefasDb) {
      // Conexão em cache revalida o metadado a cada uso: após `reverter` (ou qualquer estado ≠ ativo) fecha e falha fechado.
      try { validarTarefasDb(tarefasDb, tarefasFixture ?? "fonte canônica"); return tarefasDb; }
      catch (e) { try { tarefasDb.close(); } catch {} tarefasDb = null; throw e; }
    }
    if (tarefasFixture && !opts.tarefasDb && !existsSync(tarefasFixture)) {
      mkdirSync(dirname(tarefasFixture), { recursive: true });
      inicializarTarefasFixture(tarefasFixture).close();
    }
    tarefasDb = abrirTarefasDb(tarefasFixture ?? resolverFonteTarefas().caminho);
    return tarefasDb;
  };
  const port = opts.port ?? Number(process.env.IRH_PORT ?? 4317);
  ensureLibrary(root);
  ensureFunis(root);
  rmSync(join(root, ".tmp"), { recursive: true, force: true });
  const ctx: Ctx = { db: openDb(root), root };
  refreshCtaKeywords(ctx.db);
  ensureClientSlugs(ctx.db);
  ensureProfiles(ctx.db);
  registrarPerfisVault(ctx.db);
  syncReplicationExperts(ctx.db, root);
  syncPipeline(ctx.db, root, { origem: "boot" });
  const dl = opts.downloader ?? (process.env.IRH_DOWNLOADER === "fake" ? fakeDownloader : ytdlp);
  const importer = new Importer(ctx, dl);
  const preparation = new ReplicationPreparation(ctx, root, opts.replicationPreparation);
  const productionExecution=new ProductionService(ctx);
  // Abrir a interface em manutenção não retoma filas nem aciona integrações.
  // Cliques/comandos explícitos conservam os controles e autorizações existentes.
  const retomarNoBoot = opts.resumeOnBoot !== false;
  if (retomarNoBoot) {
    preparation.resume();
    productionExecution.resume();
    importer.resume();
  }
  const angulos = new FilaAngulos(ctx);
  importer.on((ev) => { if (ev.type === "item" && ev.item.status === "ok" && ev.item.ref_id) angulos.enfileirar(ev.item.ref_id); });
  if (retomarNoBoot) { angulos.varrer(true); angulos.agendar(); }
  // Agenda automática: post pronto ganha data no próximo horário livre (meta por dia). Boot + a cada 2 min; fora dos testes.
  const repsResumo = () => pipelineSnapshot(ctx).map((r: any) => ({ id: r.id, etapa: r.etapa, editado: r.editado ?? null }));
  if (retomarNoBoot && process.env.NODE_ENV !== "test" && process.env.IRH_AGENDA_AUTO !== "0") {
    const rodarAgenda = () => {
      try { const r = agendarAutomatico(ctx, repsResumo()); if (r.criados.length || r.agendados.length) invalidatePipeline(ctx.db); }
      catch (e) { console.error("agenda automática:", e); }
    };
    setTimeout(rodarAgenda, 3000);
    setInterval(rodarAgenda, 120_000);
  }
  // Agenda do Mac acompanha as demandas (T-n): além de rodar a cada mudança de situação, ressincroniza no boot e a cada 10 min.
  if (retomarNoBoot) {
    setTimeout(sincronizarAgenda, 15_000);
    setInterval(sincronizarAgenda, 600_000);
  }

  const id = (s: string) => {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new HttpError(400, "ID inválido");
    return n;
  };

  const routes: [string, RegExp, Handler][] = [
    ["GET", /^\/api\/execucao$/, (_r,_p,u) => json(executionContext(ctx,u.searchParams.get('ref'),u.searchParams.get('expert')))],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\/execucao$/, (_r,[id])=>json(productionExecution.state(id))],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\/execucao\/pacote$/, (r,[id])=>serveFile(r,productionExecution.package(id),'pacote-video-'+id+'.zip')],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao$/, async(r,[id])=>{const input=await body(r);return json(await withActor(r.headers.get('x-irh-agente'),()=>productionExecution.start(id,input)),202);}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/(STILL\d+)\/decisao$/, async(r,[id,item])=>{const input=await body(r);return json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.decision(id,item,input)));}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/prompts$/, async(r,[id])=>{const input=await body(r);return json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.refreshImagePrompts(id,String(input.itens??'').split(',').map(s=>s.trim()).filter(Boolean))));}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/((?:STILL|SHOT)\d+)\/reenviar$/, async(r,[id,item])=>{const input=await body(r);return json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.retry(id,item,String(input.motivo??''))));}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/modelo$/, async(r,[id])=>{const input=await body(r);return json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.switchModel(id,input)));}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/coletar$/, (r,[id])=>json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.collect(id)))],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/aprovar$/, async(r,[id])=>{const input=await body(r);return json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.approveImages(id,String(input.itens??'').split(',').map(s=>s.trim()).filter(Boolean))));}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/((?:STILL|SHOT)\d+)\/tentativa$/, async(r,[id,item])=>{const input=await body(r);return json(withActor(r.headers.get('x-irh-agente'),()=>productionExecution.authorizeAttempt(id,item,input)));}],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/execucao\/(STILL\d+)\/imagem$/, async(r,[id,item])=>{const bytes=new Uint8Array(await r.arrayBuffer());return json(await withActor(r.headers.get('x-irh-agente'),()=>productionExecution.upload(id,item,bytes)));}],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\/execucao\/((?:STILL|SHOT)\d+)\/media$/, (r,[id,item])=>serveFile(r,productionExecution.media(id,item))],
    ["POST", /^\/api\/refs\/(REF-[\d-]+)\/pacote-chat$/, async(req,[ref]) => json(await prepareChatPackage(ctx,ref,await body(req)),201)],
    ["GET", /^\/api\/refs\/(REF-[\d-]+)\/pacotes-chat$/, (_r,[ref]) => json(listChatPackages(ctx,ref))],
    ["GET", /^\/api\/refs\/(REF-[\d-]+)\/pacotes-chat\/([a-z0-9-]+)\/([a-f0-9-]+)$/, (req,[ref,slug,id]) => serveFile(req,chatPackageZip(ctx,ref,slug,id),'pacote-chat-'+ref+'-'+slug+'.zip')],
    ["GET", /^\/api\/stats$/, () => (pipelineSnapshot(ctx), json(cat.stats(ctx)))],
    // Contrato único do ciclo para PainelExperts e ClientesRoadmap (SPEC §6.3).
    ["GET", /^\/api\/pipeline$/, (_r, _p, u) => {
      pipelineSnapshot(ctx);
      const pub = u.searchParams.get("publico");
      return json(listPipeline(ctx, u.searchParams.get("profile"), pub === "1" || pub === "true"));
    }],
    ["PATCH", /^\/api\/pipeline\/([\w-]+)$/, async (req, [pid]) => json(patchPipeline(ctx, pid, await body(req)))],
    ["GET", /^\/api\/profiles$/, () => (pipelineSnapshot(ctx), json(listProfiles(ctx)))],
    ["GET", /^\/api\/prompts$/, () => json(listarPrompts(root))],
    ["POST", /^\/api\/prompts\/([\w-]+)\/favorito$/, async (req, [id]) => {
      const b = await body(req).catch(() => null);
      const r = marcarFavorito(root, id, typeof b?.favorito === "boolean" ? b.favorito : undefined);
      if (!r) throw new HttpError(404, "Prompt não encontrado");
      return json(r);
    }],
    ["POST", /^\/api\/prompts\/([\w-]+)\/uso$/, (_req, [id]) => {
      const r = registrarUso(root, id);
      if (!r) throw new HttpError(404, "Prompt não encontrado");
      return json(r);
    }],
    // Perfis do Instagram analisados (aba /perfis). Dados em library/perfis/ (perfil.json vem do AnaliseInstagram).
    ["GET", /^\/api\/perfis$/, () => json(listarPerfis(root))],
    ["POST", /^\/api\/perfis$/, async (req) => json(adicionarPerfil(root, await body(req)), 201)],
    ["GET", /^\/api\/perfis\/([\w.]+)$/, (_r, [h]) => json(obterPerfil(root, h))],
    ["GET", /^\/api\/perfis\/([\w.]+)\/posts\/([\w-]+)$/, (_r, [h, code]) => json(fichaPost(root, h, code))],
    ["PATCH", /^\/api\/perfis\/([\w.]+)$/, async (req, [h]) => json(atualizarPerfil(root, h, await body(req)))],
    ["DELETE", /^\/api\/perfis\/([\w.]+)$/, (_r, [h]) => json(removerPerfil(root, h))],
    // Funis (demonstrativos) + swipe de funil. Arquivos em library/funis/ (ver LEIA-ME.md lá).
    ["GET", /^\/api\/funis\/posts-produzidos$/, (_r, _p, u) => json({ itens: postsProduzidos(ctx, u.searchParams.get("profile")) })],
    ["GET", /^\/api\/funis$/, (_r, _p, u) => json(listarFunis(ctx, { profile: u.searchParams.get("profile"), completo: ["1", "true"].includes(u.searchParams.get("completo") ?? "") }))],
    ["POST", /^\/api\/funis$/, async (req) => json(criarFunil(ctx, await body(req)), 201)],
    ["GET", /^\/api\/funis\/([\w-]+)$/, (_r, [fid]) => json(obterFunil(ctx, fid))],
    ["PUT", /^\/api\/funis\/([\w-]+)$/, async (req, [fid]) => json(salvarFunil(ctx, fid, await body(req)))],
    ["PATCH", /^\/api\/funis\/([\w-]+)$/, async (req, [fid]) => json(salvarFunil(ctx, fid, await body(req)))],
    ["DELETE", /^\/api\/funis\/([\w-]+)$/, (_r, [fid]) => json(apagarFunil(ctx, fid))],
    ["POST", /^\/api\/funis\/([\w-]+)\/duplicar$/, async (req, [fid]) => json(duplicarFunil(ctx, fid, await body(req).catch(() => ({}))), 201)],
    ["GET", /^\/api\/swipes$/, (_r, _p, u) => json(listarSwipes(root, { tipo: u.searchParams.get("tipo"), profile: u.searchParams.get("profile"), q: u.searchParams.get("q") }))],
    ["POST", /^\/api\/swipes$/, async (req) => json(criarSwipe(root, await body(req)), 201)],
    ["PATCH", /^\/api\/swipes\/([\w-]+)$/, async (req, [sid]) => json(atualizarSwipe(root, sid, await body(req)))],
    ["DELETE", /^\/api\/swipes\/([\w-]+)$/, (_r, [sid]) => json(apagarSwipe(root, sid))],
    ["GET", /^\/api\/swipes\/([\w-]+)\/imagem$/, (req, [sid]) => serveFile(req, imagemSwipe(root, sid))],
    ["POST", /^\/api\/swipes\/([\w-]+)\/imagem$/, async (req, [sid]) => {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Envie a imagem no campo file");
      return json(await gravarImagemSwipe(root, sid, file));
    }],
    ["GET", /^\/api\/vault\/paginas$/, () => json(paginasVault())],
    ["GET", /^\/api\/vault\/pagina$/, (_r, _p, u) => json(paginaVault(u.searchParams.get("p") ?? ""))],
    ["GET", /^\/api\/vault\/imagem$/, (req, _p, u) => serveFile(req, vaultImagem(u.searchParams.get("p") ?? ""))],
    ["POST", /^\/api\/vault\/abrir$/, async (req) => {
      const b = await body(req);
      const abs = vaultAbs(String(b.p ?? ""));
      abrirNoSistema(abs, !!b.finder);
      return json({ path: abs });
    }],
    // Tarefas da operação (aba Tarefas).
    ["GET", /^\/api\/tarefas$/, (_r, _p, u) => json({ tarefas: listarTarefas(tarefas(), { frente: u.searchParams.get("frente"), quem: u.searchParams.get("quem"), todas: u.searchParams.has("todas") }), opcoes: opcoesTarefas(tarefas()) })],
    ["POST", /^\/api\/tarefas$/, async (req) => json(criarTarefa(tarefas(), await body(req)), 201)],
    ["PATCH", /^\/api\/tarefas\/([\w-]+)$/, async (req, [tid]) => json(editarTarefa(tarefas(), idTarefa(tid), await body(req)))],
    ["DELETE", /^\/api\/tarefas\/([\w-]+)$/, (_r, [tid]) => json(apagarTarefa(tarefas(), idTarefa(tid)))],
    // Carrosséis: lidos da pasta do perfil no vault (Conteúdo/**/PostNN); status só pelos arquivos + Postagens.md.
    ["GET", /^\/api\/carrosseis$/, (_r, _p, u) => json(listarCarrosseis(u.searchParams.get("profile")))],
    ["GET", /^\/api\/carrosseis\/([\w-]+)$/, (_r, [cid]) => { const c = obterCarrossel(cid); if (!c) throw new HttpError(404, "Carrossel não encontrado"); return json(c); }],
    ["GET", /^\/api\/carrosseis\/([\w-]+)\/arquivo$/, (req, [cid], u) => {
      const f = arquivoCarrossel(cid, u.searchParams.get("p") ?? "");
      if (!f) throw new HttpError(404, "Arquivo não encontrado");
      return serveFile(req, f);
    }],
    ["POST", /^\/api\/carrosseis\/([\w-]+)\/abrir$/, (_r, [cid]) => {
      const c = obterCarrossel(cid);
      if (!c) throw new HttpError(404, "Carrossel não encontrado");
      abrirNoSistema(c.pasta);
      return json({ path: c.pasta });
    }],
    ["GET", /^\/api\/replicacoes$/, () => json(listReplicacoes(ctx.db, root))],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\/producao$/, (_r, [id]) => {
      const rep = getReplicacao(ctx.db, root, id);
      if (!rep.replicacao || !rep.slug) throw new HttpError(404, "Replicação sem expert");
      return json(flowProduction(root, rep.ref, rep.slug));
    }],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\/producao\/editado$/, (req, [id]) => {
      const rep = getReplicacao(ctx.db, root, id);
      if (!rep.replicacao || !rep.slug) throw new HttpError(404, "Replicação sem expert");
      const file = flowEditedVideo(root, rep.ref, rep.slug);
      if (!file) throw new HttpError(404, "Vídeo editado não encontrado");
      return serveFile(req, file);
    }],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/producao\/editado\/revelar$/, (_r, [id]) => {
      const rep = getReplicacao(ctx.db, root, id);
      if (!rep.replicacao || !rep.slug) throw new HttpError(404, "Replicação sem expert");
      const file = flowEditedVideo(root, rep.ref, rep.slug);
      if (!file) throw new HttpError(404, "Vídeo editado não encontrado");
      abrirNoSistema(file, true);
      return json({ path: file });
    }],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\/producao\/media\/(SHOT\d+)\/(image|video)$/, (req, [id, shot, kind]) => {
      const rep = getReplicacao(ctx.db, root, id);
      if (!rep.replicacao || !rep.slug) throw new HttpError(404, "Replicação sem expert");
      const file = flowProductionMedia(root, rep.ref, rep.slug, shot, kind);
      if (!file) throw new HttpError(404, "Mídia não encontrada");
      return serveFile(req, file);
    }],
    ["POST", /^\/api\/replicacoes$/, async (req) => json(preparation.enqueue(await body(req)), 202)],
    ["POST", /^\/api\/replicacoes\/(REF-[\d-]+)\/segmentar$/, async (req, [ref]) => json(await segmentarRef(ctx.db, root, ref, !!(await body(req))?.refazer_transcricao))],
    ["POST", /^\/api\/replicacoes\/(REF-[\d-]+)\/analisar$/, (_req,[ref])=>json(analisarRef(ctx.db,root,ref),202)],
    ["PUT", /^\/api\/replicacoes\/(REF-[\d-]+)\/analise$/, async(req,[ref])=>{const result=await importarAnalise(ctx.db,root,ref,await body(req));preparation.resume(ref);return json(result);}],
    ["GET", /^\/api\/replicacoes\/([\w-]+)\.md$/, (_r, [id], u) => new Response(markdownReplicacao(ctx.db, root, id, u.searchParams.get("versao") ?? undefined), { headers: { "content-type": "text/markdown; charset=utf-8" } })],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/frames$/, (_r, [id]) => json(prepararFramesReplicacao(ctx.db, root, id))],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/frames\/reveal$/, async (req, [id]) => json(await revelarFramesReplicacao(ctx.db, root, id, await body(req), opts.finder))],
    ["GET", /^\/api\/replicacoes\/([\w-]+)$/, (_r, [id]) => json(getReplicacao(ctx.db, root, id))],
    ["PATCH", /^\/api\/replicacoes\/([\w-]+)\/config$/, async(req,[id])=>json(configurarReplicacao(ctx.db,root,id,await body(req)))],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/publicacao\/atualizar$/, async (_req, [id], u) => json(await refreshPublication(ctx.db, root, id, dl, u.searchParams.get("post") ?? undefined))],
    // Posts (seções do Postagens.md do perfil): fonte única de calendário e publicação, para Hub e painel.
    ["GET", /^\/api\/postagem\/fila$/, (_r, _m, u) => {
      const dia = u.searchParams.get("dia") || undefined;
      if (dia && (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(dia)) || new Date(dia).toISOString().slice(0,10) !== dia)) throw new HttpError(400, "Dia inválido");
      return json(montarFilaPostagem(listarPosts(ctx.db, root, repsResumo()), { dia, profile: u.searchParams.get("profile") }));
    }],
    ["POST", /^\/api\/posts\/([\w-]+)\/revelar$/, async (_r, [id]) => {
      const p = lerPostsVault(root).find(p => p.id === id);
      if (!p) throw new HttpError(404, "Post não encontrado");
      if (p.tipo === "carrossel") {
        const car = listarCarrosseis(p.perfil.slug).find(c => c.postagem_id === p.id || c.rel === (p.secao.c.pasta ?? "").replace(/\/+$/, ""));
        if (!car) throw new HttpError(404, "Pasta do carrossel não encontrada");
        { const r = await abrirNoSistema(car.pasta); if (r) throw new HttpError(500, "Não foi possível abrir o Finder"); }
        return json({ path: car.pasta });
      }
      const file = p.tipo === "proprio" ? arquivoVideoProprio(id) : p.ref && p.personagem ? flowEditedVideo(root, p.ref, p.personagem) : null;
      if (!file) throw new HttpError(404, "Vídeo final não encontrado");
      { const r = await abrirNoSistema(file, true); if (r) throw new HttpError(500, "Não foi possível abrir o Finder"); }
      return json({ path: file });
    }],
    ["GET", /^\/api\/posts$/, (_r, _m, u) => {
      const reps = pipelineSnapshot(ctx).map((r: any) => ({ id: r.id, etapa: r.etapa, editado: r.editado ?? null }));
      const rep = u.searchParams.get("replicacao");
      const itens = listarPosts(ctx.db, root, reps, { profile: u.searchParams.get("profile") }).filter((p) => !rep || p.replicacao === rep);
      const slug = rep?.split("--")[1];
      return json({ itens, lido_em: new Date().toISOString(), ...(rep ? { gerido: !!slug && geridoPelaNota(slug) } : {}) });
    }],
    ["GET", /^\/api\/agenda$/, () => json(agendaConfig(ctx))],
    ["POST", /^\/api\/agenda\/planejar$/, () => {
      const r = agendarAutomatico(ctx, repsResumo(), { forcar: true });
      invalidatePipeline(ctx.db);
      return json(r);
    }],
    ["POST", /^\/api\/posts$/, async (req) => {
      const b = await body(req);
      const p = criarPost(ctx.db, root, String(b?.replicacao ?? ""), { versao: b?.versao, canal: b?.canal ?? null, agendado_para: b?.agendado_para ?? null });
      invalidatePipeline(ctx.db);
      return json({ id: p.id }, 201);
    }],
    ["PATCH", /^\/api\/posts\/([\w-]+)$/, async (req, [id]) => {
      const p = atualizarPost(id, await body(req));
      invalidatePipeline(ctx.db);
      return json({ id: p.id, publicacao: p.publicacao });
    }],
    ["GET", /^\/api\/posts\/([\w-]+)\/video$/, (req, [id]) => {
      const f = arquivoVideoProprio(id);
      if (!f) throw new HttpError(404, "Vídeo do post não encontrado");
      return serveFile(req, f);
    }],
    ["POST", /^\/api\/replicacoes\/([\w-]+)\/arquivar$/, async (req, [id]) => json(arquivarReplicacao(ctx.db, root, id, await body(req)))],
    ["PATCH", /^\/api\/replicacoes\/([\w-]+)$/, async (req, [id]) => json(setStatus(ctx.db, root, id, await body(req)))],
    ["GET", /^\/api\/refs$/, (_r, _p, u) => (pipelineSnapshot(ctx), json(listRefs(ctx, parseFilters(u))))],
    ["GET", /^\/api\/refs\/([\w-]+)$/, (_r, [rid]) => {
      pipelineSnapshot(ctx);
      const r = getRef(ctx, rid);
      return r ? json(r) : json({ error: "Referência não encontrada" }, 404);
    }],
    ["PATCH", /^\/api\/refs\/([\w-]+)$/, async (req, [rid]) => json(updateRef(ctx, rid, await body(req)))],
    ["DELETE", /^\/api\/refs\/([\w-]+)$/, (_r, [rid]) => (deleteRef(ctx, rid), json({ ok: true }))],
    ["POST", /^\/api\/refs\/([\w-]+)\/angulos$/, async (_r, [rid]) => (await analisarAngulos(ctx, rid), json(getRef(ctx, rid)))],
    ["POST", /^\/api\/refs\/([\w-]+)\/metrics$/, async (_r, [rid]) => (await importer.refreshMetrics(rid), json(getRef(ctx, rid)))],
    ["POST", /^\/api\/refs\/([\w-]+)\/reveal$/, (_r, [rid]) => {
      const r = getRef(ctx, rid);
      if (!r?.abs_path || !r.file_exists) throw new HttpError(404, "Arquivo não encontrado no disco");
      abrirNoSistema(r.abs_path, true);
      return json({ path: r.abs_path });
    }],
    ["POST", /^\/api\/refs\/([\w-]+)\/markers$/, async (req, [rid]) => {
      const b = await body(req);
      const t = Number(b.t);
      if (!Number.isFinite(t) || t < 0) throw new HttpError(400, "Tempo inválido");
      if (!getRef(ctx, rid)) throw new HttpError(404, "Referência não encontrada");
      ctx.db.run("INSERT INTO markers (ref_id, t, label, created_at) VALUES (?, ?, ?, ?)", [rid, t, String(b.label ?? "").slice(0, 300), now()]);
      return json(getRef(ctx, rid)!.markers);
    }],
    ["PATCH", /^\/api\/markers\/(\d+)$/, async (req, [mid]) => {
      const b = await body(req);
      ctx.db.run("UPDATE markers SET label = ? WHERE id = ?", [String(b.label ?? "").slice(0, 300), id(mid)]);
      return json({ ok: true });
    }],
    ["DELETE", /^\/api\/markers\/(\d+)$/, (_r, [mid]) => (ctx.db.run("DELETE FROM markers WHERE id = ?", [id(mid)]), json({ ok: true }))],
    ["GET", /^\/api\/duplicates$/, () => json(duplicateGroups(ctx))],

    ["GET", /^\/api\/clients$/, () => (pipelineSnapshot(ctx), json(cat.listClients(ctx)))],
    ["POST", /^\/api\/clients$/, async (req) => json(cat.createClient(ctx, await body(req)), 201)],
    ["GET", /^\/api\/clients\/(\d+)$/, (_r, [cid]) => json(cat.getClient(ctx, id(cid)))],
    ["PATCH", /^\/api\/clients\/(\d+)$/, async (req, [cid]) => json(cat.updateClient(ctx, id(cid), await body(req)))],
    ["DELETE", /^\/api\/clients\/(\d+)$/, (_r, [cid]) => (cat.deleteClient(ctx, id(cid)), json({ ok: true }))],
    ["GET", /^\/api\/projects$/, () => json(cat.listProjects(ctx))],
    ["POST", /^\/api\/projects$/, async (req) => json(cat.createProject(ctx, await body(req)), 201)],
    ["PATCH", /^\/api\/projects\/(\d+)$/, async (req, [pid]) => json(cat.updateProject(ctx, id(pid), await body(req)))],
    ["DELETE", /^\/api\/projects\/(\d+)$/, (_r, [pid]) => (cat.deleteProject(ctx, id(pid)), json({ ok: true }))],
    ["GET", /^\/api\/formatos$/, () => json(cat.listFormatos(ctx))],
    ["POST", /^\/api\/formatos$/, async (req) => json(cat.createFormato(ctx, await body(req)), 201)],
    ["GET", /^\/api\/categories$/, () => json(cat.listCategories(ctx))],
    ["POST", /^\/api\/categories$/, async (req) => json(cat.createCategory(ctx, await body(req)), 201)],
    ["PATCH", /^\/api\/categories\/(\d+)$/, async (req, [x]) => json(cat.updateCategory(ctx, id(x), await body(req)))],
    ["DELETE", /^\/api\/categories\/(\d+)$/, (_r, [x]) => (cat.deleteCategory(ctx, id(x)), json({ ok: true }))],
    ["GET", /^\/api\/tags$/, () => json(cat.listTags(ctx))],
    ["GET", /^\/api\/facets$/, (_r, _p, u) => (pipelineSnapshot(ctx), json(cat.facets(ctx, u.searchParams.get("todos") === "1")))],
    ["POST", /^\/api\/facets\/([a-z_]+)\/values$/, async (req, [key]) => json(cat.createFacetValue(ctx, key, await body(req)), 201)],

    ["GET", /^\/api\/collections$/, () => json(cat.listCollections(ctx))],
    ["POST", /^\/api\/collections$/, async (req) => json(cat.createCollection(ctx, await body(req)), 201)],
    ["GET", /^\/api\/collections\/(\d+)$/, (_r, [x]) => json(cat.getCollection(ctx, id(x)))],
    ["PATCH", /^\/api\/collections\/(\d+)$/, async (req, [x]) => json(cat.updateCollection(ctx, id(x), await body(req)))],
    ["DELETE", /^\/api\/collections\/(\d+)$/, (_r, [x]) => (cat.deleteCollection(ctx, id(x)), json({ ok: true }))],
    ["POST", /^\/api\/collections\/(\d+)\/refs$/, async (req, [x]) => {
      const b = await body(req);
      if (!Array.isArray(b.refs)) throw new HttpError(400, "Informe refs: []");
      cat.addToCollection(ctx, id(x), b.refs.map(String), !!b.remove);
      return json({ ok: true });
    }],
    ["GET", /^\/api\/collections\/(\d+)\/export$/, async (req, [x]) => {
      const out = await exportCollection(ctx, id(x));
      return serveFile(req, out, basename(out));
    }],

    ["POST", /^\/api\/import$/, async (req) => {
      const b = await body(req);
      const urls: string[] = Array.isArray(b.urls) ? b.urls.map(String) : extractUrls(String(b.text ?? ""));
      return json(importer.enqueue(urls, "links", parseAssign(b)), 201);
    }],
    ["POST", /^\/api\/import\/csv$/, async (req) => {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) throw new HttpError(400, "Envie um arquivo CSV");
      const urls = extractUrls(await file.text());
      if (!urls.length) throw new HttpError(400, "Nenhum link do Instagram encontrado no CSV");
      const a = form.get("assign");
      return json(importer.enqueue(urls, "csv", parseAssign(typeof a === "string" ? JSON.parse(a) : {})), 201);
    }],
    ["POST", /^\/api\/import\/manual$/, async (req) => {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new HttpError(400, "Envie um arquivo de vídeo");
      const fields: Record<string, string> = {};
      for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
      const rid = await importer.importManual(file, fields);
      angulos.enfileirar(rid);
      return json(getRef(ctx, rid), 201);
    }],
    ["POST", /^\/api\/import\/drive$/, async (req) => {
      const b = await body(req);
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(b ?? {})) if (v != null) fields[k] = Array.isArray(v) ? v.join(",") : String(v);
      const rid = await importer.importDrive(fields);
      angulos.enfileirar(rid);
      return json(getRef(ctx, rid), 201);
    }],
    ["GET", /^\/api\/import\/jobs$/, () => json(importer.jobs())],
    ["GET", /^\/api\/import\/jobs\/(\d+)$/, (_r, [x]) => json(importer.job(id(x)))],
    ["GET", /^\/api\/import\/events$/, (req) => {
      let off = () => {};
      let ping: Timer;
      const stream = new ReadableStream({
        start(c) {
          const send = (s: string) => { try { c.enqueue(s); } catch { off(); } };
          off = importer.on((ev) => send(`data: ${JSON.stringify(ev)}\n\n`));
          ping = setInterval(() => send(": ping\n\n"), 15000);
          send(": ok\n\n");
          req.signal.addEventListener("abort", () => { off(); clearInterval(ping); });
        },
        cancel() { off(); clearInterval(ping); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
    }],

    ["GET", /^\/api\/export\.csv$/, (_r, _p, u) => new Response(exportCsv(ctx, parseFilters(u)), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="referencias-${stamp()}.csv"` },
    })],
    ["GET", /^\/api\/export\.xlsx$/, async (req, _p, u) => {
      const out = await exportXlsx(ctx, parseFilters(u));
      return serveFile(req, out, basename(out));
    }],
    ["GET", /^\/api\/backups$/, () => json(listBackups(root))],
    ["POST", /^\/api\/backup$/, async () => json(await createBackup(ctx), 201)],
    ["GET", /^\/api\/backups\/([\w.-]+\.zip)$/, (req, [name]) => {
      const abs = safeJoin(join(root, "backups"), name);
      if (!abs || !existsSync(abs)) throw new HttpError(404, "Backup não encontrado");
      return serveFile(req, abs, name);
    }],
    ["POST", /^\/api\/restore$/, async (req, _p, u) => {
      if (importer.busy) throw new HttpError(409, "Há uma importação em andamento. Aguarde terminar para restaurar.");
      let zipPath: string;
      const name = u.searchParams.get("name");
      if (name) {
        const abs = safeJoin(join(root, "backups"), name);
        if (!abs || !existsSync(abs)) throw new HttpError(404, "Backup não encontrado");
        zipPath = abs;
      } else {
        if (!req.body) throw new HttpError(400, "Envie o arquivo .zip do backup");
        mkdirSync(join(root, ".tmp"), { recursive: true });
        zipPath = join(root, ".tmp", `upload-${Date.now()}.zip`);
        const sink = Bun.file(zipPath).writer();
        for await (const chunk of req.body) sink.write(chunk);
        await sink.end();
      }
      try {
        const res = await restoreBackup(root, zipPath, (doMove) => {
          ctx.db.close();
          try { doMove(); } finally { ctx.db = openDb(root); }
        });
        return json(res);
      } finally {
        if (!name) rmSync(zipPath, { force: true });
      }
    }],
    ["GET", /^\/api\/storage$/, () => json(storage(root))],
    ["GET", /^\/api\/settings$/, () => json({ ...cat.getSettings(ctx), library: root })],
    ["PATCH", /^\/api\/settings$/, async (req) => json({ ...cat.updateSettings(ctx, await body(req)), library: root })],
    ["POST", /^\/api\/library\/reveal$/, () => {
      abrirNoSistema(root);
      return json({ path: root });
    }],
  ];

  const allowedHosts = new Set<string>();
  const allowedOrigins = new Set<string>();

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Proteções de app local: DNS rebinding (Host) e CSRF (Origin de outro site).
    const host = req.headers.get("host") ?? "";
    if (!allowedHosts.has(host) && !(opts.dev && /^(127\.0\.0\.1|localhost):5173$/.test(host))) return new Response("Host não permitido", { status: 403 });
    const origin = req.headers.get("origin");
    if (req.method !== "GET" && req.method !== "HEAD" && origin && !allowedOrigins.has(origin)) return new Response("Origem não permitida", { status: 403 });

    const path = decodePath(url.pathname);
    if (path == null) return new Response("Caminho inválido", { status: 400 });
    if (path.startsWith("/api/")) {
      for (const [method, re, h] of routes) {
        const m = path.match(re);
        if (m && method === req.method) return h(req, m.slice(1), url);
      }
      return json({ error: "Rota não encontrada" }, 404);
    }
    // Páginas do vault por http (só as pastas de páginas). HTML em sandbox: origem opaca, sem acesso à API do Hub.
    // Arquivo com caminho absoluto pedido por uma página do vault ("/_next/x.js"), que o Hub não tem: vem da pasta da página.
    const doVault = path.startsWith("/vault/") ? path.slice("/vault/".length)
      : path.startsWith("/api/") || path.startsWith("/media/") ? null
      : !isFile(safeJoin(WEB_DIST, path) ?? "") ? vaultPorRaizRecente(path) : null;
    if (doVault) {
      const v = await servirVault(doVault);
      if (!v) return new Response("Arquivo não encontrado", { status: 404 });
      const res = v.conteudo != null ? new Response(v.conteudo as BodyInit) : serveFile(req, v.abs);
      res.headers.set("Content-Type", v.tipo);
      res.headers.set("X-Content-Type-Options", "nosniff");
      res.headers.set("Cache-Control", "no-cache");
      if (v.html) res.headers.set("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox");
      // Documento em sandbox tem origem "null": módulos e fontes da própria página precisam de CORS para carregar.
      if (req.headers.get("origin") === "null") res.headers.set("Access-Control-Allow-Origin", "null");
      return res;
    }
    if (path.startsWith("/media/")) {
      const abs = safeJoin(root, path.slice("/media/".length));
      const top = path.split("/")[2];
      // perfis/: só as imagens (perfis/<handle>/midia/*); perfil.json e estado.json saem pela API.
      const perfilImg = top === "perfis" && /^\/media\/perfis\/[\w.]+\/midia\/[\w.-]+\.(webp|jpg|png|mp4)$/.test(path);
      if (!abs || !(["videos", "thumbnails", "replicacoes", "slides", "avatars"].includes(top) || perfilImg) || !isFile(abs)) return new Response("Arquivo não encontrado", { status: 404 });
      return serveFile(req, abs);
    }
    // Interface (build estático) com fallback de SPA.
    const asset = safeJoin(WEB_DIST, path);
    if (asset && path !== "/" && isFile(asset) && Bun.file(asset).size > 0) {
      const res = serveFile(req, asset);
      if (path.startsWith("/assets/")) res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return res;
    }
    const index = join(WEB_DIST, "index.html");
    if (existsSync(index)) return new Response(Bun.file(index), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    return new Response("Interface não compilada. Rode: bun run build", { status: 503 });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    maxRequestBodySize: 8 * 1024 ** 3,
    async fetch(req) {
      try {
        return await handle(req);
      } catch (e: any) {
        if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
        if (e instanceof TarefaErro) return json({ error: e.message }, e.status);
        console.error(e);
        return json({ error: `Erro interno: ${e?.message ?? e}` }, 500);
      }
    },
  });
  // porta 0 = aleatória (testes): os hosts permitidos usam a porta real
  for (const h of [`127.0.0.1:${server.port}`, `localhost:${server.port}`]) {
    allowedHosts.add(h);
    allowedOrigins.add(`http://${h}`);
  }
  if (opts.dev) for (const h of ["127.0.0.1:5173", "localhost:5173"]) allowedOrigins.add(`http://${h}`);
  return { server, ctx, importer, preparation, root, stop: () => { productionExecution.stop(); preparation.stop(); server.stop(true); ctx.db.close(); tarefasDb?.close(); tarefasDb = null; } };
}

if (import.meta.main) {
  const dev = process.argv.includes("--dev");
  const s = startServer({ dev, resumeOnBoot: !process.argv.includes("--sem-retomar") });
  console.log(`Instagram Reference Hub → http://127.0.0.1:${s.server.port}`);
  console.log(`Biblioteca: ${s.root}`);
}
