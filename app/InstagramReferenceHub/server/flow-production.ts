import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from 'node:crypto';
import { describeProduction, productionTerminology } from "./production-terms";
import { videoFinalVault } from "./perfis-vault";
import {readWorkflow,fileHashCached} from './production-workflow';

type Json = Record<string, any>;
const FLOW_ROOT = resolve(process.env.IRH_FLOW_OUTPUTS || join(import.meta.dir, "../../GoogleFlowMCP/outputs"));

/** Review receipts bind final bytes; prose and an earlier attempt never approve a retake. */
export function clipReviewStatus(clip: Json, file: string | null): 'approved' | 'pending' | 'changed' | 'needs_changes' {
  const r=clip.review;
  if(!file||!r||r.schema!=='flow-clip-review/v1'||r.shot!==clip.shot||r.sha256!==clip.sha256)return 'pending';
  if(typeof r.reviewedAt!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(r.reviewedAt)||!Number.isFinite(Date.parse(r.reviewedAt))||typeof r.reviewer?.model!=='string'||!r.reviewer.model.trim()||r.audioReviewed!==true||r.visualReviewed!==true)return 'pending';
  try{if(createHash('sha256').update(readFileSync(file)).digest('hex')!==clip.sha256)return 'changed';}catch{return 'changed';}
  return r.status==='approved'?'approved':r.status==='needs_changes'?'needs_changes':'pending';
}

function inside(root: string, file: string) {
  const r = relative(root, file);
  return r && !r.startsWith("..") && !isAbsolute(r);
}
function read(path: string): Json | null {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
function source(library: string, ref: string, slug: string) {
  const pointer = join(library, "replicacoes", ref, slug, "flow-producao.json");
  const config = read(pointer);
  if (typeof config?.manifestPath === "string" && existsSync(config.manifestPath)) {
    const manifestPath = realpathSync(config.manifestPath);
    if (!inside(FLOW_ROOT, manifestPath) || basename(manifestPath) !== "manifesto.json") return null;
    const manifest = read(manifestPath);
    if (manifest?.ref === ref && (Array.isArray(manifest.clips) || Array.isArray(manifest.newClips))) return { manifest, folder: dirname(manifestPath), planPath: manifestPath };
  }
  if (!config?.planPath || typeof config.planPath !== "string") return null;
  if (!existsSync(config.planPath)) return null;
  const planPath = realpathSync(config.planPath);
  if (!inside(FLOW_ROOT, planPath) || basename(planPath) !== "plano.json") return null;
  const plan = read(planPath);
  if (!plan || plan.ref !== ref) return null;
  return { plan, folder: dirname(planPath), planPath };
}
const editUrlDe = (library: string, ref: string, slug: string) => flowEditedVideo(library, ref, slug) ? `/api/replicacoes/${ref}--${slug}/producao/editado` : null;
export function flowProduction(library: string, ref: string, slug: string) {
  const replication = read(join(library, "replicacoes", ref, slug, "replicacao.json"));
  const referenceIds: string[] = (replication?.shots || []).map((s: Json) => s.id);
  const workflow=readWorkflow(join(library,'replicacoes',ref,slug));
  if(workflow){
    const intact=(j:any)=>{try{return !!j?.output&&fileHashCached(j.output)===j.sha256;}catch{return false;}};
    const rows=workflow.plan.shots.map((s:any)=>{const video=workflow.jobs.find(j=>j.id===s.id)!,image=workflow.jobs.find(j=>j.id===s.still);return {id:s.id,sourceShots:s.sourceShots??[s.id],sourceTakes:s.sourceTakes??[],still:s.still,layer:s.layer??null,speech:s.speech??'',duration:s.duration,flowStatus:video.status,status:video.status==='available'&&intact(video)?'baixado':video.status==='submitted'?'enviado ao Flow':video.status==='error'?(video.history.some((h:any)=>h.status==='provider_refused')?'recusado pelo provedor':'erro registrado'):video.status==='uncertain'?'recuperação pendente':video.status==='waiting_shared'?(video.error?'erro na origem compartilhada':'aguarda fundo compartilhado'):'aguarda envio',imageUrl:intact(image)?`/api/replicacoes/${ref}--${slug}/execucao/${s.still}/media`:null,clipUrl:video.status==='available'&&intact(video)?`/api/replicacoes/${ref}--${slug}/execucao/${s.id}/media`:null,prompt:s.prompt,reviewStatus:'pending'};});
    return {connected:true,workflow:true,ref,expert:workflow.slug,...describeProduction(rows,referenceIds),terminology:productionTerminology,editUrl:editUrlDe(library,ref,slug)};
  }
  const entry = source(library, ref, slug);
  if (!entry) return { connected: false, shots: [], editUrl: editUrlDe(library, ref, slug), message: "Ainda não há um plano Flow vinculado a esta replicação." };
  if ("manifest" in entry && entry.manifest) {
    const clips = manifestClips(entry.manifest);
    const shots = clips.map((clip: Json) => {
      const candidate = typeof clip.file === "string" ? resolve(entry.folder, clip.file) : null;
      const file = candidate && existsSync(candidate) && inside(FLOW_ROOT, realpathSync(candidate)) ? candidate : null;
      return { id: clip.shot, sourceShots: clip.sourceShots || [], sourceTakes: clip.sourceTakes || [],
        still: null, speech: clip.speech || "", duration: clip.duration, flowStatus: "available",
        status: file ? "baixado" : "arquivo não localizado", reviewStatus:clipReviewStatus(clip,file),imageUrl: null,
        clipUrl: file ? `/api/replicacoes/${ref}--${slug}/producao/media/${clip.shot}/video` : null, prompt: null };
    });
    return { connected: true, ref, expert: null, editUrl: editUrlDe(library, ref, slug), collectionUrl: entry.manifest.collection || null,
      reviewSummary:{approved:shots.filter(s=>s.reviewStatus==='approved').length,pending:shots.filter(s=>s.reviewStatus!=='approved').length,qualityApproved:shots.length>0&&shots.every(s=>s.reviewStatus==='approved'),humanApproved:false},
      ...describeProduction(shots, referenceIds), terminology: productionTerminology, planPath: entry.planPath };
  }
  const { plan, folder } = entry;
  const state = read(join(folder, "flow-run.json"));
  const items = state?.items || {};
  const shots = (plan.shots || []).map((shot: Json) => {
    const item = items[shot.id] || {};
    const still = (plan.stills || []).find((s: Json) => s.id === shot.still);
    const image = still?.output;
    const clip = join(folder, `${shot.id}.shot.mp4`);
    const hasImage = typeof image === "string" && existsSync(image) && inside(realpathSync(library), realpathSync(image));
    const hasClip = existsSync(clip);
    return {
      id: shot.id, layer: shot.layer??null, sourceShots: shot.sourceShots || [], sourceTakes: shot.sourceTakes || [],
      asrReview:item.asrReview??null, still: shot.still, speech: shot.speech || "", duration: shot.duration,
      flowStatus: item.status || "not_submitted",
      status: hasClip ? "baixado" : item.status === "submitted" ? "enviado ao Flow" : item.status === "available" ? "disponível no Flow" : "aguarda envio",
      reviewStatus:clipReviewStatus({shot:shot.id,sha256:item.sha256,review:item.review},hasClip?clip:null),
      imageUrl: hasImage ? `/api/replicacoes/${ref}--${slug}/producao/media/${shot.id}/image` : null,
      clipUrl: hasClip ? `/api/replicacoes/${ref}--${slug}/producao/media/${shot.id}/video` : null,
      prompt: shot.prompt,
    };
  });
  return { connected: true, ref, expert: plan.organization?.expertProjectName || plan.expert,
    editUrl: editUrlDe(library, ref, slug),
    collectionUrl: (state?.project?.collectionUrl || plan.organization?.collectionUrl || null),
    ...describeProduction(shots, referenceIds), terminology: productionTerminology, planPath: entry.planPath };
}
export function flowProductionMedia(library: string, ref: string, slug: string, shotId: string, kind: string): string | null {
  const entry = source(library, ref, slug);
  if (!entry || !/^SHOT\d+$/.test(shotId)) return null;
  if ("manifest" in entry && entry.manifest) {
    if (kind !== "video") return null;
    const clip = manifestClips(entry.manifest).find((c: Json) => c.shot === shotId);
    if (!clip || typeof clip.file !== "string" || !existsSync(resolve(entry.folder, clip.file))) return null;
    const real = realpathSync(resolve(entry.folder, clip.file));
    return inside(FLOW_ROOT, real) ? real : null;
  }
  const shot = (entry.plan.shots || []).find((s: Json) => s.id === shotId);
  if (!shot) return null;
  const still = (entry.plan.stills || []).find((s: Json) => s.id === shot.still);
  const path = kind === "video" ? join(entry.folder, `${shotId}.shot.mp4`) : kind === "image" ? still?.output : null;
  if (typeof path !== "string" || !existsSync(path)) return null;
  const real = realpathSync(path);
  if (!inside(kind === "video" ? FLOW_ROOT : realpathSync(library), real)) return null;
  return real;
}
function manifestClips(manifest: Json): Json[] {
  const clips: Json[] = Array.isArray(manifest.clips) ? manifest.clips : manifest.newClips || [];
  if (typeof manifest.existingPilot === "string") return [{ shot: "SHOT01", file: manifest.existingPilot, duration: 6 }, ...clips];
  return clips;
}

export function flowEditedVideo(library: string, ref: string, slug: string): string | null {
  const config = read(join(library, "replicacoes", ref, slug, "flow-producao.json"));
  if (typeof config?.editPath === "string" && existsSync(config.editPath)) {
    const real = realpathSync(config.editPath);
    if (inside(FLOW_ROOT, real) && real.endsWith(".mp4")) return real;
  }
  // Flow (edicao-*/) primeiro; senão, o vídeo final entregue na pasta do perfil no vault (07_entregas/**/videos-finais/).
  return detectEdit(ref, slug) ?? videoFinalVault(ref, slug);
}
// Edição salva em <FLOW_ROOT>/<REF>/edicao-*/<REF>_<EXPERT>_edit_vN.mp4 vincula sozinha (versão mais recente; ignora _celular).
function detectEdit(ref: string, slug: string): string | null {
  const dir = join(FLOW_ROOT, ref);
  if (!existsSync(dir)) return null;
  const token = slug.split("-")[0].toUpperCase();
  const found: { path: string; mtime: number }[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.startsWith("edicao")) continue;
    for (const f of readdirSync(join(dir, d.name))) {
      if (!new RegExp(`^${ref}_${token}_edit_v\\d+\\.mp4$`).test(f)) continue;
      const path = join(dir, d.name, f);
      found.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime)[0]?.path ?? null;
}
/** Evidência real de produção: clipes baixados e vídeo editado. */
export function productionEvidence(library: string, ref: string, slug: string) {
  const workflow=readWorkflow(join(library,'replicacoes',ref,slug));
  if(workflow){const intact=(j:any)=>{try{return !!j.output&&fileHashCached(j.output)===j.sha256;}catch{return false;}};return {coverageComplete:true,images:workflow.jobs.filter(j=>j.kind==='image'&&intact(j)).length,clips:workflow.jobs.filter(j=>j.kind==='video'&&j.status==='available'&&intact(j)).length,total:workflow.jobs.filter(j=>j.kind==='video').length,editado:!!flowEditedVideo(library,ref,slug),final:!!videoFinalVault(ref,slug)};}
  const p = flowProduction(library, ref, slug) as any;
  const shots: any[] = p.shots || [];
  const summary=(p as any).summary;
  return { coverageComplete:summary?.coveredFragmentCount==null?undefined:summary.outsidePlan.length===0, images:shots.filter(s=>s.imageUrl).length, clips: shots.filter((s) => s.clipUrl).length, total: shots.length, editado: !!flowEditedVideo(library, ref, slug), final: !!videoFinalVault(ref, slug) };
}
