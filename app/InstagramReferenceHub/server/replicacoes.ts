import { lerUmaVez } from './perfis-vault';
import { espelharPublicacao } from './publication-mirror';
import {readAnalysisJob} from "./analysis-job";
import { linkReplicationExpert } from "./replication-assignments";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, lstatSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { now } from "./db";
import { expertSlug, normalizePostUrl } from "./text";
import { HttpError } from "./refs";
import { safeJoin } from "./library";
import { abrirPastaFrames, prepararPacoteFrames, type FinderOptions } from "./pacote-frames";
import { segmentar } from "./segmentar";
import { hashArquivo, lerAnalise, salvarAnalise, verificarEvidencias, type Analise } from "./analise";
import { readPreparation } from "./replication-preparation-store";
import { productionEvidence, flowEditedVideo } from "./flow-production";
import { fabricatePrompts } from "./prompt-factory";
import {loadExpertIdentity} from "./expert-production";
import { acaoReactGeracao, lint, problemas, FORMATOS, engineValida, markdown, ordem, validarAlteracao, type ReplicacaoV2 } from "./replicacao-prompts";
import { clientSlug, expertNaoEncontrado, parseIsoInput, resolveSlug, syncPipeline } from "./pipeline";
import { alvoDaReplicacao, atualizarPost, geridoPelaNota, postsDaReplicacao, lerPostsVault, resumoPorReplicacao } from "./posts";

// Duas camadas:
//   <biblioteca>/replicacoes/<REF>/            análise da referência (shots.json, transcricao.json, frames/, sheet.jpg) — uma por REF
//   <biblioteca>/replicacoes/<REF>/<expert>/   replicação para um expert (replicacao.json) — uma REF pode ir pra vários experts
// ID de uma replicação = "<REF>--<slug-do-expert>". O banco guarda só o status por item (STILLnn / SHOTnn / EDITADO / POSTADO).
const REF_RE = /^REF-\d{4}-\d{2}-\d{4}$/;
const ID_RE = /^(REF-\d{4}-\d{2}-\d{4})(?:--([a-z0-9-]+))?$/;
export const ETAPAS = ["analise", "prompts", "gerando", "edicao", "pronto", "postado"] as const;

const readJson = (file: string) => { try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; } catch { return null; } };
export const slugify = expertSlug;

function parseId(id: string) {
  const m = id.match(ID_RE);
  if (!m) throw new HttpError(400, "ID de replicação inválido");
  return { ref: m[1], slug: m[2] as string | undefined };
}

/**
 * Resolve "<REF>--<slug>" aceitando o slug do personagem, o do perfil ou um alias (ex.: bruno-goytacaz → pasta bruno-goytacazes).
 * A pasta existente manda (compatível com trabalhos antigos); slug que o Hub não conhece = 404 "expert não encontrado".
 * Devolve o ID canônico (o da pasta).
 */
export function resolveReplicacaoId(db: Database, root: string, id: string): { ref: string; slug: string | undefined; id: string } {
  const { ref, slug } = parseId(id);
  if (!slug) return { ref, slug, id: ref };
  const base = join(root, "replicacoes", ref);
  if (existsSync(join(base, slug))) return { ref, slug, id: `${ref}--${slug}` };
  const r = resolveSlug(db, slug);
  if (!r || !r.clients.length) throw expertNaoEncontrado(db, slug);
  const hit = r.clients.find((c) => existsSync(join(base, c.slug))) ?? r.clients[0];
  return { ref, slug: hit.slug, id: `${ref}--${hit.slug}` };
}
function refDir(root: string, ref: string) {
  const d = safeJoin(root, join("replicacoes", ref));
  if (!d) throw new HttpError(400, "REF inválida");
  return d;
}
function statusOf(db: Database, id: string): Record<string, string> {
  const rows = db.query("SELECT item, status FROM replicacao_status WHERE ref = ?").all(id) as { item: string; status: string }[];
  return Object.fromEntries(rows.map((r) => [r.item, r.status]));
}

function obrigatorios(rep: ReplicacaoV2 | null): string[] {
  if (!rep) return [];
  return ordem(rep).filter((o) => o.tipo === "shot" || !rep.stills.find((s) => s.id === o.item)?.opcional).map((o) => o.item);
}
type Evid = { coverageComplete?:boolean; images?:number; clips: number; total: number; editado: boolean; final?: boolean; postUrl: string | null; postadoEm: string | null; registradoEm: string | null; arquivadoEm: string | null } | null;
// Etapa = a mais avançada entre o checklist manual e a evidência real (clipes baixados, vídeo editado, link do post).
export function etapa(rep: ReplicacaoV2 | null, st: Record<string, string>, ev: Evid = null) {
  if (!rep) return "analise";
  if (st.POSTADO === "feito" || ev?.postUrl) return "postado";
  // Pronto = vídeo final em videos-finais/ ou EDITADO marcado; rascunho de edição (edit_vN) ainda é edição.
  if (st.EDITADO === "feito" || ev?.final) return "pronto";
  if (ev?.editado) return "edicao";
  if (ev && ev.total > 0 && ev.clips === ev.total && ev.coverageComplete !== false) return "edicao";
  const ob = obrigatorios(rep), f = ob.filter((i) => st[i] === "feito").length;
  if (f > 0 && f === ob.length) return "edicao";
  return f === 0 && !ev?.clips && !ev?.images ? "prompts" : "gerando";
}
function evidencia(root: string, ref: string, slug: string): Evid {
  try {
    const e = productionEvidence(root, ref, slug);
    const cfg = readJson(join(root, "replicacoes", ref, slug, "flow-producao.json"));
    const s = (v: unknown) => (!geridoPelaNota(slug) && typeof v === "string" ? v : null);
    return { ...e, postUrl: s(cfg?.postUrl), postadoEm: s(cfg?.postadoEm), registradoEm: s(cfg?.registradoEm), arquivadoEm: s(cfg?.arquivadoEm) };
  } catch { return null; }
}

const capaDe = (db: Database, ref: string) => (db.query("SELECT thumb_path FROM refs WHERE id = ?").get(ref) as any)?.thumb_path ?? null;

export function listReplicacoes(db: Database, root: string, onlyRef?: string) { return lerUmaVez(() => lerReplicacoes(db, root, onlyRef)); }
function lerReplicacoes(db: Database, root: string, onlyRef?: string) {
  const baseDir = join(root, "replicacoes");
  if (!existsSync(baseDir)) return [];
  const out: any[] = [];
  for (const e of readdirSync(baseDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !REF_RE.test(e.name)) continue;
    if (onlyRef && e.name !== onlyRef) continue;
    const d = join(baseDir, e.name);
    const seg = readJson(join(d, "shots.json"));
    const capa = capaDe(db, e.name);
    const experts = readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory() && (existsSync(join(d, x.name, "replicacao.json")) || !!readPreparation(root,e.name,x.name)));
    if (!experts.length) out.push({ id: e.name, ref: e.name, expert: null, etapa: "analise", preparacao: readPreparation(root,e.name,null), shots: seg?.shots?.length ?? 0, capa });
    for (const x of experts) {
      const id = `${e.name}--${x.name}`;
      const rep = readJson(join(d, x.name, "replicacao.json")) as ReplicacaoV2 | null;
      const preparacao = readPreparation(root,e.name,x.name);
      const st = statusOf(db, id), ob = obrigatorios(rep), ev = rep ? evidencia(root, e.name, x.name) : null;
      if (geridoPelaNota(x.name)) delete st.POSTADO;
      out.push({ status: st, id, ref: e.name, expert: rep?.expert ?? preparacao?.expert ?? x.name, slug: x.name, formato: rep?.formato ?? preparacao?.input.formato, preparacao: rep ? null : preparacao, etapa: st.POSTADO !== "feito" && rep && problemas(rep,seg).some(p=>p.nivel==="erro") ? "analise" : etapa(rep, st, ev), feitos: ob.filter((i) => st[i] === "feito").length, total: ob.length, clips: ev?.clips ?? 0, clipsTotal: ev?.total ?? 0, shots: rep?.shots?.length ?? seg?.shots?.length ?? 0, capa, editado: ev?.editado ? `/api/replicacoes/${id}/producao/editado` : null, postUrl: ev?.postUrl ?? null, postadoEm: ev?.postadoEm ?? null, registradoEm: ev?.registradoEm ?? null, arquivadoEm: ev?.arquivadoEm ?? null });
    }
  }
  const resumos = resumoPorReplicacao(lerPostsVault(root));
  return out.map(item => item.slug ? espelharPublicacao(item, resumos.get(item.id), geridoPelaNota(item.slug)) : item);
}

export function getReplicacao(db: Database, root: string, requested: string) {
  const { ref, slug, id } = resolveReplicacaoId(db, root, requested);
  const d = refDir(root, ref);
  if (!existsSync(d)) throw new HttpError(404, "Replicação não encontrada");
  const seg = readJson(join(d, "shots.json"));
  const rep = slug ? (readJson(join(d, slug, "replicacao.json")) as ReplicacaoV2 | null) : null;
  const preparacao = readPreparation(root,ref,slug??null);
  if (slug && !rep && !preparacao) throw new HttpError(404, "Replicação não encontrada");
  const st = statusOf(db, id);
  if (slug && geridoPelaNota(slug)) delete st.POSTADO;
  const analise=lerAnalise(d);
  const issues=rep?problemas(rep,seg):[];
  if(analise){try{const row=db.query("SELECT video_path, duration FROM refs WHERE id = ?").get(ref) as any;const video=row?.video_path?safeJoin(root,row.video_path):null;if(!video)throw new Error("Vídeo ausente");verificarEvidencias(analise,d,video,ref,row.duration);if(hashArquivo(join(d,"analise.json"))!==seg?.analise_sha256)throw new Error("Segmentação usa revisão anterior da análise");}catch(e){issues.push({nivel:"erro",codigo:"EVIDENCIA",mensagem:String((e as Error).message)});}}
  else issues.push({nivel:"erro",codigo:"ANALISE",mensagem:"Execute a leitura visual e valide o mapa de estados antes de gerar"});
  const avisos = issues.map(p=>`${p.nivel.toUpperCase()} [${p.codigo}] ${p.mensagem}`);
  for (const s of rep?.stills ?? []) if (!existsSync(join(d, s.frame)) || (s.frame_sha256 && hashArquivo(join(d,s.frame))!==s.frame_sha256)) issues.push({nivel:"erro",codigo:"ARQUIVO",mensagem:`${s.id}: arquivo ${s.frame} não existe.`});
  if (rep && /TODO/.test(JSON.stringify(rep))) avisos.unshift(`Ainda há campos TODO (quem está no quadro / ação). Numa sessão: “analisa a replicação ${id}”.`);
  const outras = listReplicacoes(db, root).filter((r) => r.ref === ref && r.id !== id).map((r) => ({ id: r.id, expert: r.expert }));
  const ev = slug ? evidencia(root, ref, slug) : null;
  const promptsPorFerramenta=[];
  for(const shot of rep?.shots??[])try{promptsPorFerramenta.push(fabricatePrompts(rep!,shot));}catch(e){issues.push({nivel:"erro",codigo:"PROMPT",mensagem:(e as Error).message});}
  const resultado = { promptsPorFerramenta, id, ref, preparacao: rep ? null : preparacao, analise, analise_job: readAnalysisJob(join(d,"evidencias/job.json")), problemas: issues, bloqueada: issues.some(p=>p.nivel==="erro"), slug: slug ?? null, shots: seg, replicacao: rep, status: st, legendasPost: slug ? readJson(join(d, slug, "legendas-post.json")) : null, postUrl: ev?.postUrl ?? null, postadoEm: ev?.postadoEm ?? null, registradoEm: ev?.registradoEm ?? null, arquivadoEm: ev?.arquivadoEm ?? null, publicacaoInfo: slug ? readJson(join(d, slug, "flow-producao.json"))?.publicacaoInfo ?? null : null, etapa: st.POSTADO !== "feito" && rep && problemas(rep,seg).some(p=>p.nivel==="erro") ? "analise" : etapa(rep, st, slug ? evidencia(root, ref, slug) : null), avisos: [...avisos,...issues.filter(p=>p.codigo==="ARQUIVO").map(p=>p.mensagem)], outras };
  return espelharPublicacao(resultado, resumoPorReplicacao(lerPostsVault(root)).get(id), !!slug && geridoPelaNota(slug));
}

export function setStatus(db: Database, root: string, requested: string, input: any) {
  const atual=getReplicacao(db, root, requested);
  const id = atual.id;
  // Perfil com Postagens.md no vault: publicar é por POST (seção da nota), nunca pela replicação inteira.
  const soData = input?.item === undefined && input?.postadoEm !== undefined;
  if (atual.slug && geridoPelaNota(atual.slug) && (input?.item === "POSTADO" || soData)) {
    if (soData) {
      const p = alvoDaReplicacao(db, root, id, input?.post, "postado");
      if (!p) throw new HttpError(409, "Marque como postado antes de corrigir a data");
      atualizarPost(p.id, { postado_em: parseIsoInput(input.postadoEm, "postadoEm") });
    } else if (input?.status === "feito") {
      const p = alvoDaReplicacao(db, root, id, input?.post, "aberto")!;
      atualizarPost(p.id, { publicacao: "postado", ...(input?.url !== undefined ? { url: input.url } : {}),
        ...(input?.postadoEm !== undefined ? { postado_em: parseIsoInput(input.postadoEm, "postadoEm") } : {}) });
    } else {
      const p = alvoDaReplicacao(db, root, id, input?.post, "postado");
      if (p) atualizarPost(p.id, { publicacao: "a_publicar" });
    }
    syncPipeline(db, root, { ref: atual.ref, origem: "postagens" });
    return getReplicacao(db, root, id);
  }
  // Só corrigir a data/hora real do post (postei.py --quando): { postadoEm } sem item.
  if (input?.item === undefined && input?.postadoEm !== undefined) return corrigirPostadoEm(db, root, atual, input.postadoEm);
  const item = String(input?.item ?? "");
  // O bloqueio protege a GERAÇÃO. Um post que já está no ar é fato: registrar POSTADO nunca é bloqueado pela análise.
  if(input?.status==="feito" && atual.bloqueada && item!=="POSTADO")throw new HttpError(409,"Geração bloqueada: corrija a análise/lint antes de marcar concluído");
  const status = input?.status === "feito" ? "feito" : "pendente";
  if (!/^(STILL\d{2}|SHOT\d{2}[a-z]?|EDITADO|POSTADO)$/.test(item)) throw new HttpError(400, "Item inválido");
  const { ref, slug } = atual;
  // Validação completa antes de gravar qualquer coisa. postadoEm = hora real do post (informada); registradoEm = quando foi marcado aqui.
  const postadoEm = item === "POSTADO" && input?.postadoEm !== undefined ? parseIsoInput(input.postadoEm, "postadoEm") : undefined;
  const url = item === "POSTADO" ? normalizePostUrl(String(input?.url ?? "")) : "";
  if (status === "feito" && url && !/^https:\/\/(www\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//.test(url)) throw new HttpError(400, "Link do post inválido");
  db.run(
    "INSERT INTO replicacao_status (ref, item, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(ref, item) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
    [id, item, status, now()],
  );
  if (slug && (item === "POSTADO" || item === "EDITADO")) {
    const f = join(refDir(root, ref), slug, "flow-producao.json"), cfg = readJson(f) ?? { schema: 1 };
    if (item === "POSTADO") {
      if (status === "feito") {
        if (input?.url !== undefined && cfg.postUrl !== (url || null)) { delete cfg.publicacaoInfo; if (cfg.postadoEmFonte === 'link') { delete cfg.postadoEm; delete cfg.postadoEmFonte; } }
        if (input?.url !== undefined) cfg.postUrl = url || null;
        if (input?.postadoEm !== undefined) {
          if (postadoEm) { cfg.postadoEm = postadoEm; cfg.postadoEmFonte = 'manual'; }
          else { delete cfg.postadoEm; delete cfg.postadoEmFonte; }
        }
        cfg.registradoEm ??= now();
      }
      else { delete cfg.postUrl; delete cfg.postadoEm; delete cfg.registradoEm; delete cfg.publicacaoInfo; delete cfg.postadoEmFonte; }
    }
    if (item === "EDITADO" && status === "feito" && !cfg.editPath) { const e = flowEditedVideo(root, ref, slug); if (e) cfg.editPath = e; }
    writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n");
  }
  syncPipeline(db, root, { ref, origem: "replicacao" });
  return getReplicacao(db, root, id);
}

/**
 * Arquivar = tirar da fila de postagem sem apagar nada: `arquivadoEm` no flow-producao.json (a fonte),
 * e o espelho (ref_pipeline) vira 'descartada'. Desarquivar remove o campo e a etapa volta a ser calculada.
 */
export function arquivarReplicacao(db: Database, root: string, requested: string, input: any) {
  const atual = getReplicacao(db, root, requested);
  if (!atual.slug) throw new HttpError(400, "Arquivar é por REF × expert (use <REF>--<slug>)");
  const arquivar = input?.arquivado !== false;
  if (geridoPelaNota(atual.slug)) {
    const ps = postsDaReplicacao(root, atual.id).filter((p) => input?.post ? p.id === input.post : arquivar ? p.publicacao === "a_publicar" : p.publicacao === "arquivado");
    if (input?.post && !ps.length) throw new HttpError(404, `Post ${input.post} não é desta replicação`);
    for (const p of ps) atualizarPost(p.id, { publicacao: arquivar ? "arquivado" : "a_publicar" });
    syncPipeline(db, root, { ref: atual.ref, origem: arquivar ? "arquivo" : "desarquivo" });
    return getReplicacao(db, root, atual.id);
  }
  const f = join(refDir(root, atual.ref), atual.slug, "flow-producao.json"), cfg = readJson(f) ?? { schema: 1 };
  if (arquivar) cfg.arquivadoEm ??= now();
  else delete cfg.arquivadoEm;
  writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n");
  syncPipeline(db, root, { ref: atual.ref, origem: arquivar ? "arquivo" : "desarquivo" });
  return getReplicacao(db, root, atual.id);
}

function corrigirPostadoEm(db: Database, root: string, atual: ReturnType<typeof getReplicacao>, valor: unknown) {
  if (!atual.slug) throw new HttpError(400, "Data do post é por REF × expert");
  const quando = parseIsoInput(valor, "postadoEm");
  if (!quando) throw new HttpError(400, "postadoEm é obrigatório para corrigir a data do post");
  const f = join(refDir(root, atual.ref), atual.slug, "flow-producao.json"), cfg = readJson(f);
  if (!cfg || atual.status.POSTADO !== "feito") throw new HttpError(409, "Marque como postado antes de corrigir a data");
  cfg.postadoEm = quando; cfg.postadoEmFonte = "manual";
  writeFileSync(f, JSON.stringify(cfg, null, 2) + "\n");
  syncPipeline(db, root, { ref: atual.ref, origem: "replicacao" });
  return getReplicacao(db, root, atual.id);
}

export async function segmentarRef(db: Database, root: string, ref: string, refazerTranscricao = false, maxShot = 10, porCortes = false) {
  if (!REF_RE.test(ref)) throw new HttpError(400, "REF inválida");
  const r = db.query("SELECT video_path, duration FROM refs WHERE id = ?").get(ref) as any;
  if (!r?.video_path) throw new HttpError(404, "Referência sem vídeo");
  const video = safeJoin(root, r.video_path);
  if (!video || !existsSync(video)) throw new HttpError(404, "Arquivo de vídeo não encontrado");
  const d = refDir(root, ref);
  mkdirSync(d, { recursive: true });
  if (refazerTranscricao) rmSync(join(d, "transcricao.json"), { force: true });
  await segmentar({ ref, video, dir: d, duracao: r.duration, params: { max_shot: maxShot, ...(porCortes ? { por_cortes: true } : {}) } });
  return getReplicacao(db, root, ref);
}

// Esqueleto de replicação a partir da segmentação: 1 still por setup visual, 1 shot por shot.
// Campos de análise (quem está no quadro, ação) nascem TODO — quem preenche é a sessão com a skill replicar-referencia.
export function criarReplicacao(db: Database, root: string, input: any) {
  const ref = String(input?.ref ?? "");
  if (!REF_RE.test(ref)) throw new HttpError(400, "REF inválida");
  const ex = db.query("SELECT * FROM clients WHERE id = ?").get(Number(input?.expert_id)) as any;
  if (!ex) throw new HttpError(400, "Escolha o expert");
  if (!ex.avatar) throw new HttpError(400, `Cadastre a contact sheet do avatar em Experts → ${ex.name} (ex.: contactsheet${ex.name.replace(/\s+/g, "")}01).`);
  const d = refDir(root, ref);
  if(!FORMATOS.includes(input?.formato??"EXPERT"))throw new HttpError(400,"Formato sem playbook");
  if(!engineValida(input?.engine??"Veo 3"))throw new HttpError(400,"Engine sem template");
  const analise=lerAnalise(d);
  if(!analise)throw new HttpError(409,"Conclua a leitura visual e o mapa de estados primeiro");
  const seg = readJson(join(d, "shots.json"));
  if (!seg) throw new HttpError(409, "Segmente a referência primeiro");
  const fonte=db.query("SELECT video_path,duration FROM refs WHERE id=?").get(ref) as any;
  const video=fonte?.video_path?safeJoin(root,fonte.video_path):null;
  if(!video)throw new HttpError(409,"Referência sem vídeo");
  try{verificarEvidencias(analise,d,video,ref,fonte.duration);}catch(e){throw new HttpError(409,(e as Error).message);}
  if(hashArquivo(join(d,"analise.json"))!==seg.analise_sha256)throw new HttpError(409,"Ressegmente a revisão atual antes de criar prompts");
  const slug = clientSlug(ex);
  const file = join(d, slug, "replicacao.json");
  if (existsSync(file)) throw new HttpError(409, "Já existe replicação desta REF para este expert");
  const stills: ReplicacaoV2["stills"] = [];
  for (const s of seg.shots) for (const t of s.takes) {
    const reused=stills.find(x=>x.id===t.still);
    if(reused){reused.sourceWindows??=reused.sourceWindow?[reused.sourceWindow]:[];reused.sourceWindows.push([t.ini,t.fim]);continue;}
    const m=analise.shots.find(x=>x.id===s.id)!;
    stills.push({ sourceWindow:[t.ini,t.fim], id:t.still,take:t.id,frame:t.frame,quem:m.quem,boca:s.mudo||!m.quem||/rosto fora/i.test(m.quem)?"livre":"fechada",olhar:!m.quem?false:t.estado_visual?.olhar==="lente",estado:t.estado,frame_sha256:t.frame_sha256,angulo:m.angulo,uso:`Estado de ${t.id}` });
  }
  const usados = new Set(seg.shots.map((s: any) => s.takes[0].still));
  stills.forEach((s) => { if (!usados.has(s.id)) { s.opcional = true; s.uso = `Inserto opcional (${s.take})`; s.boca = "livre"; } });
  const perfil=loadExpertIdentity(root,{slug,expert:ex.name,avatar:ex.avatar})?.profile;
  const presentation=perfil?.presentation;
  const alteracao=perfil?.alteracao??perfil?.produto;
  if(input?.formato==="TROCA DE PRODUTO"){try{validarAlteracao(alteracao);}catch(e){throw new HttpError(409,'Alteração pontual: '+(e as Error).message);}}
  const rep: ReplicacaoV2 = {
    versao: 3, analise_sha256:seg.analise_sha256, ref, expert: ex.name, slug, formato: input?.formato ?? "EXPERT", engine: input?.engine??"Veo 3",
    ...(input?.formato==="TROCA DE PRODUTO"?{troca:alteracao!}:{}),
    idioma_fala: input?.idioma_fala ?? perfil?.idiomaFala ?? "português do Brasil", genero: ex.genero === "mulher" ? "mulher" : "homem",
    avatar: ex.avatar, avatar_estilo: ex.avatar_estilo === "real" ? "real" : "3d",
    copy: { ativa: "V1", versoes: [{ id: "V1", nome: "Original", falas: {}, ...(presentation?.voiceDirection?{direcao_voz:presentation.voiceDirection}:{}) }] },
    stills,
    shots: seg.shots.map((s: any) => ({
      id: s.id, janela: [s.ini, s.fim], still: s.takes[0].still, tipo: input?.formato==="RECEITA POV"?"inserto":analise.shots.find(m=>m.id===s.id)!.tipo, fala: s.fala,
      acao: analise.shots.find(m=>m.id===s.id)!.acao,
      camadas: analise.shots.find(m=>m.id===s.id)!.camadas,
      composicaoSegmentos:analise.shots.find(m=>m.id===s.id)!.composicaoSegmentos,
      ...(input?.formato==="REACT + ANIMAÇÃO"?{react_acao:acaoReactGeracao(analise.shots.find(m=>m.id===s.id)!.camadas?.react?.acao)}:{}),
      evento:analise.shots.find(m=>m.id===s.id)!.evento,
      notas:analise.shots.find(m=>m.id===s.id)!.incertezas.join("; "),
      morfose:analise.shots.find(m=>m.id===s.id)!.morfose,
      angulo:analise.shots.find(m=>m.id===s.id)!.angulo,
      referencia_take:s.takes[0].id,estado_inicial:s.takes[0].estado,estado_final:s.takes.at(-1).estado,
      olhar:s.takes[0].estado_visual?.olhar==="lente",
      takes_extras: s.takes.slice(1).map((t: any) => t.id),
    })),
    pos: ["Legendas palavra a palavra e @ do expert no rodapé (edição, nunca no prompt).", "Entrega 9:16 1080x1920."],
    decisoes: [],
  };
  if(analise.conferencia?.tipo === "automatica") {
    const errors=problemas(rep,seg).filter(p=>p.nivel==="erro");
    if(errors.length)throw new HttpError(409,`Prompts ainda não passaram na validação: ${errors.map(p=>p.mensagem).join("; ")}`);
  }
  mkdirSync(join(d, slug), { recursive: true });
  writeFileSync(file, JSON.stringify(rep, null, 1));
  linkReplicationExpert(db,ref,ex.id);
  syncPipeline(db, root, { ref, origem: "replicacao" });
  return getReplicacao(db, root, `${ref}--${slug}`);
}

export function markdownReplicacao(db: Database, root: string, id: string, versao?: string) {
  const r = getReplicacao(db, root, id);
  if (!r.replicacao) throw new HttpError(404, "Replicação sem prompts");
  if(r.bloqueada)throw new HttpError(409,"Exportação bloqueada: corrija os erros da análise/lint");
  const md = markdown(r.replicacao, r.shots, versao || r.replicacao.copy.ativa);
  writeFileSync(join(refDir(root, r.ref), r.slug!, `replicacao${versao && versao !== r.replicacao.copy.ativa ? `-${versao}` : ""}.md`), md);
  return md;
}

export async function importarAnalise(db:Database,root:string,ref:string,input:Analise){
  if(!REF_RE.test(ref))throw new HttpError(400,"REF inválida");
  const row=db.query("SELECT video_path, duration FROM refs WHERE id = ?").get(ref) as any;
  const video=row?.video_path?safeJoin(root,row.video_path):null;
  if(!video)throw new HttpError(404,"Referência sem vídeo");
  const dir=refDir(root,ref);mkdirSync(dir,{recursive:true});
  try{salvarAnalise(input,dir,video,ref,row.duration);}catch(e){throw new HttpError(400,(e as Error).message);}
  await segmentarRef(db,root,ref);
  return getReplicacao(db,root,ref);
}
export function analisarRef(db:Database,root:string,ref:string){
  if(!REF_RE.test(ref))throw new HttpError(400,"REF inválida");
  const row=db.query("SELECT video_path FROM refs WHERE id = ?").get(ref) as any;
  if(!row?.video_path)throw new HttpError(404,"Referência sem vídeo");
  const dir=join(refDir(root,ref),"evidencias");mkdirSync(dir,{recursive:true});
  const job=readJson(join(dir,"job.json"));
  if(job?.status==="analisando"&&Date.now()-Date.parse(job.iniciado_em)<15*60e3)throw new HttpError(409,"Análise já está em andamento");
  writeFileSync(join(dir,"job.json"),JSON.stringify({status:"analisando",iniciado_em:new Date().toISOString()}));
  const proc=Bun.spawn([process.env.IRH_ANALYSIS_PYTHON??(existsSync("/opt/homebrew/bin/python3")?"/opt/homebrew/bin/python3":"python3"),join(import.meta.dir,"../scripts/analisar-revisao.py"),ref,"--root",root],{stdout:"ignore",stderr:"ignore"});
  writeFileSync(join(dir,"job.json"),JSON.stringify({status:"analisando",iniciado_em:new Date().toISOString(),worker_pid:proc.pid}));
  void proc.exited.then(code=>{const j=readJson(join(dir,"job.json"));if(j?.status==="analisando")writeFileSync(join(dir,"job.json"),JSON.stringify({...j,status:code?"erro":"aguardando_conferencia",code}));});
  return {status:"analisando",ref};
}

export function configurarReplicacao(db:Database,root:string,id:string,input:any){
  const atual=getReplicacao(db,root,id),rep=atual.replicacao;
  if(!rep||!atual.slug)throw new HttpError(404,"Replicação não encontrada");
  if(input?.engine!==undefined){if(!engineValida(input.engine))throw new HttpError(400,"Engine sem template");rep.engine=input.engine;}
  if(input?.formato!==undefined){if(!FORMATOS.includes(input.formato))throw new HttpError(400,"Formato sem playbook");rep.formato=input.formato;
    if(["REACT","REACT + ANIMAÇÃO"].includes(rep.formato))for(const shot of rep.shots){
      if(!shot.react_acao && shot.camadas?.react?.presente)shot.react_acao=acaoReactGeracao(shot.camadas.react.acao);
    }
  }
  if(input?.copy!==undefined){
    const c=input.copy;
    if(!Array.isArray(c?.versoes)||!c.versoes.length||!c.versoes.some((v:any)=>v.id===c.ativa))throw new HttpError(400,"Copy inválida");
    if(new Set(c.versoes.map((v:any)=>v.id)).size!==c.versoes.length)throw new HttpError(400,"Versões repetidas");
    for(const v of c.versoes){
      if(!/^V\d+$/.test(v.id)||typeof v.nome!=="string"||!v.falas||typeof v.falas!=="object"||Array.isArray(v.falas))throw new HttpError(400,"Versão inválida");
      for(const campos of [v.falas,v.legendas??{}])for(const [shot,fala] of Object.entries(campos))if(!rep.shots.some(s=>s.id===shot)||typeof fala!=="string"||fala.length>5000)throw new HttpError(400,"Fala deve apontar para shot existente");
    }
    for(const v of c.versoes)if(v.medicoes!==undefined){
      if(typeof v.medicoes!=="object"||Array.isArray(v.medicoes))throw new HttpError(400,"Medições inválidas");
      for(const [shot,m] of Object.entries(v.medicoes as Record<string,any>))if(!rep.shots.some(s=>s.id===shot)||!Number.isFinite(m?.segundos)||m.segundos<=0||typeof m?.fonte!=="string")throw new HttpError(400,"Medição deve apontar para shot existente, com segundos e fonte");
    }
    rep.copy=c;
  }
  // Instrução extra por imagem inicial (ex.: trocar a foto da tela do celular), anexada ao prompt do still.
  if(input?.stills!==undefined){
    if(!Array.isArray(input.stills))throw new HttpError(400,"stills deve ser uma lista");
    for(const x of input.stills){
      const st=rep.stills.find(s=>s.id===x?.id);if(!st||typeof x.extras!=="string"||x.extras.length>2000)throw new HttpError(400,"Still inexistente ou instrução inválida");
      if(x.extras.trim())st.extras=x.extras.trim();else delete st.extras;
    }
  }
  const dir=join(refDir(root,atual.ref),atual.slug),hist=join(dir,"historico");mkdirSync(hist,{recursive:true});
  writeFileSync(join(hist,`replicacao-${hashArquivo(join(dir,"replicacao.json")).slice(0,16)}.json`),readFileSync(join(dir,"replicacao.json")));
  writeFileSync(join(dir,"replicacao.json"),JSON.stringify(rep,null,2));
  // Config/copy nova invalida marcações de geração para evitar aprovação herdada.
  db.run("DELETE FROM replicacao_status WHERE ref = ?",[atual.id]);
  syncPipeline(db, root, { ref: atual.ref, origem: "replicacao" });
  return getReplicacao(db,root,atual.id);
}


export function prepararFramesReplicacao(db: Database, root: string, id: string) {
  const { ref } = resolveReplicacaoId(db, root, id), dir = refDir(root, ref);
  if (!existsSync(dir)) throw new HttpError(404, "Referência não encontrada");
  if (lstatSync(dir).isSymbolicLink() || !realpathSync(dir).startsWith(realpathSync(root) + sep)) throw new HttpError(409, "Pasta de referência fora da biblioteca ou link simbólico");
  getReplicacao(db, root, id); // Confere também o expert, quando o ID o inclui.
  return prepararPacoteFrames(dir, ref);
}

export async function revelarFramesReplicacao(db: Database, root: string, id: string, input: any, finder?: FinderOptions) {
  const escopo = input?.escopo ?? "principais";
  if (escopo !== "principais" && escopo !== "todos") throw new HttpError(400, "Escolha imagens-base ou todos os takes");
  const pacote = prepararFramesReplicacao(db, root, id);
  return { ...pacote, ...await abrirPastaFrames(escopo === "todos" ? pacote.todos : pacote.principais, finder), escopo };
}
