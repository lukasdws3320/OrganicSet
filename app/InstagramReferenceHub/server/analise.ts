import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export type AnguloVideo = { plano: string; altura: string; orientacao: string; movimento: string };
export type EstadoVisual = {
  ini: number; fim: number; t_frame: number;
  setup: string; props: string[]; pose: string;
  maos: { esquerda: string; direita: string }; olhar: string;
  antes: string; depois: string;
  evidencia: { frame: string; frame_sha256: string; observacao: string; gemini?: string; corroboracao?: string };
};
export type ShotAnalise = {
  id: string; ini: number; fim: number; fala: string;
  quem: string | null; tipo: "falado" | "falado + interação" | "mudo" | "inserto";
  angulo: AnguloVideo; acao: string; evento: string;
  composicaoSegmentos?: {ini:number;fim:number;fala:string;camadas:NonNullable<ShotAnalise["camadas"]>}[];
  camadas?: {fundo?:{acao:string;estilo:string;presente:boolean};react?:{acao:string;enquadramento:string;presente:boolean}};
  morfose?: string; estados: EstadoVisual[]; incertezas: string[];
};
export type Analise = {
  versao: 1; ref: string; video_sha256: string; duracao: number; revisado_em: string;
  fontes: {
    watch: { arquivo: string; sha256: string; skill: string; versao: string };
    gemini?: { arquivo: string; sha256: string; modelos: string[] };
    visual?: { arquivo: string; sha256: string; leituras: { arquivo: string; sha256: string; modelo: string; effort: string }[] };
  };
  shots: ShotAnalise[]; decisoes: string[];
  conferencia?: { tipo: "automatica"; metodo: string; envelope_segundos: number };
};
export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const hashArquivo = (p: string) => sha256(readFileSync(p));
export function arquivoLocal(dir: string, p: string): string {
  if (typeof p !== "string" || isAbsolute(p) || !p || p.includes("\\")) throw new Error("Caminho de evidência inválido");
  const abs = resolve(dir, p), rel = relative(resolve(dir), abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Evidência fora da REF");
  if (existsSync(abs) && relative(realpathSync(dir), realpathSync(abs)).startsWith("..")) throw new Error("Evidência fora da REF (symlink)");
  return abs;
}
const texto = (x: unknown): x is string => typeof x === "string" && !!x.trim() && !/\bTODO\b/.test(x);
const numero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export function chaveEstado(e: EstadoVisual, a: AnguloVideo): string {
  // O estado semântico é autoridade: pixel parecido nunca funde props/contatos diferentes.
  return JSON.stringify([e.setup, [...e.props].sort(), e.pose, e.maos.esquerda, e.maos.direita, a.plano, a.altura, a.orientacao]);
}
export function validarMapa(a: Analise, ref: string, duracao: number): string[] {
  const erros: string[] = [];
  if (!a || a.versao !== 1 || a.ref !== ref || !Array.isArray(a.shots) || !a.shots.length) return ["Mapa de estado inválido (versão 1 e shots são obrigatórios)"];
  if (!/^[a-f0-9]{64}$/.test(a.video_sha256 ?? "")) erros.push("Hash do vídeo ausente");
  if (!texto(a.revisado_em) || !Number.isFinite(Date.parse(a.revisado_em))) erros.push("Conferência visual ausente");
  if (!numero(a.duracao) || Math.abs(a.duracao - duracao) > .12) erros.push("Duração do mapa diverge do vídeo");
  for (const k of ["watch", a.fontes?.visual ? "visual" : "gemini"] as const) {
    const f = a.fontes?.[k];
    if (!f || !texto(f.arquivo) || !/^[a-f0-9]{64}$/.test(f.sha256)) erros.push(`Evidência ${k} ausente`);
  }
  if (a.fontes?.visual) {
    const readers = a.fontes.visual.leituras;
    if (!Array.isArray(readers) || readers.length !== 2 || new Set(readers.map(x=>x.modelo)).size !== 2 || !readers.every(x=>texto(x.arquivo)&&/^[a-f0-9]{64}$/.test(x.sha256)&&texto(x.modelo)&&x.effort==="low")) erros.push("Dupla leitura visual incompleta");
  } else if (!a.fontes?.gemini?.modelos?.length) erros.push("Modelo Gemini não registrado");
  let fim = 0;
  for (const [i, s] of a.shots.entries()) {
    const id = `SHOT${String(i + 1).padStart(2,"0")}`;
    if (s.id !== id) erros.push(`Ordem inválida: esperado ${id}`);
    if (!numero(s.ini) || !numero(s.fim) || s.fim <= s.ini || Math.abs(s.ini - fim) > .04) erros.push(`${id}: janela descontínua/inválida`);
    // 8,1 s: corte de câmera de até 8,1 s cabe num clipe de 8 s esticado <1,3% na edição (TROCA DE PRODUTO, 09/11/2026).
    if (s.fim - s.ini > 8.11) erros.push(`${id}: janela maior que oito segundos; divida em fronteira de fala`);
    // O mapa da fonte não escolhe a engine. Omni aceita 10 s; a checagem final
    // de preset e ritmo da fala acontece na replicação por expert.
    if (typeof s.fala !== "string" || s.fala.trim().split(/\s+/).filter(Boolean).length > 30) erros.push(`${id}: fala inválida ou acima de trinta palavras`);
    if (!texto(s.acao) || typeof s.evento !== "string" || !Array.isArray(s.incertezas)) erros.push(`${id}: ação/evento/incertezas incompletos`);
    if (!["falado", "falado + interação", "mudo", "inserto"].includes(s.tipo)) erros.push(`${id}: tipo inválido`);
    if (s.quem !== null && !texto(s.quem)) erros.push(`${id}: pessoa não identificada`);
    if (![s.angulo?.plano,s.angulo?.altura,s.angulo?.orientacao,s.angulo?.movimento].every(texto)) erros.push(`${id}: ângulo do vídeo incompleto`);
    if (!Array.isArray(s.estados) || !s.estados.length) { erros.push(`${id}: sem estados visuais`); continue; }
    let efim = s.ini;
    for (const e of s.estados) {
      if (![e.ini,e.fim,e.t_frame].every(numero) || Math.abs(e.ini-efim)>.04 || e.fim<=e.ini || e.t_frame<e.ini || e.t_frame>=e.fim) erros.push(`${id}: estado/frame fora de sua janela`);
      if (![e.setup,e.pose,e.maos?.esquerda,e.maos?.direita,e.olhar,e.antes,e.depois,e.evidencia?.observacao,e.evidencia?.frame,a.fontes?.visual?e.evidencia?.corroboracao:e.evidencia?.gemini].every(texto) || !Array.isArray(e.props) || !e.props.every(texto)) erros.push(`${id}: descrição ou cruzamento de estado incompleto`);
      efim=e.fim;
    }
    if (Math.abs(efim-s.fim)>.04) erros.push(`${id}: estados não cobrem o shot`);
    fim=s.fim;
  }
  if (Math.abs(fim-duracao)>.12) erros.push("Mapa não cobre o final do vídeo");
  return erros;
}
export function verificarEvidencias(a: Analise, dir: string, video: string, ref: string, duracao: number) {
  const erros=validarMapa(a,ref,duracao);
  if (erros.length) throw new Error(erros.join("; "));
  if (hashArquivo(video)!==a.video_sha256) throw new Error("Análise desatualizada: vídeo mudou");
  const reports: Record<string,string>={};
  const visualKey = a.fontes.visual ? "visual" : "gemini";
  for (const k of ["watch",visualKey] as const) {
    const f=a.fontes[k]!, abs=arquivoLocal(dir,f.arquivo);
    if (!existsSync(abs) || hashArquivo(abs)!==f.sha256) throw new Error(`Evidência ${k} ausente ou alterada`);
    reports[k]=readFileSync(abs,"utf8");
  }
  if (!reports.watch.includes("## Frames") || !reports.watch.includes("reason=")) throw new Error("Watch sem frames timestampados");
  if (!reports[visualKey].includes("# Análise")) throw new Error("Relatório visual inválido");
  for(const reader of a.fontes.visual?.leituras??[]) {
    const file=arquivoLocal(dir,reader.arquivo);
    if(!existsSync(file)||hashArquivo(file)!==reader.sha256)throw new Error("Leitura visual ausente ou alterada");
  }
  for (const s of a.shots) for (const e of s.estados) {
    const f=arquivoLocal(dir,e.evidencia.frame);
    if (!existsSync(f) || hashArquivo(f)!==e.evidencia.frame_sha256 || !reports.watch.includes(f)) throw new Error(`${s.id}: frame não veio do Watch`);
    if (!reports[visualKey].includes((a.fontes.visual?e.evidencia.corroboracao:e.evidencia.gemini)!)) throw new Error(`${s.id}: cruzamento visual não encontrado na evidência`);
  }
}
export function lerAnalise(dir: string): Analise | null {
  const file=join(dir,"analise.json");
  return existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null;
}
export function salvarAnalise(a: Analise, dir: string, video: string, ref: string, duracao: number) {
  verificarEvidencias(a,dir,video,ref,duracao);
  const old=join(dir,"analise.json");
  if (existsSync(old)) {
    const hist=join(dir,"historico"); mkdirSync(hist,{recursive:true});
    writeFileSync(join(hist,`analise-${hashArquivo(old).slice(0,16)}.json`),readFileSync(old));
  }
  writeFileSync(old,JSON.stringify(a,null,2));
  mkdirSync(join(dir,"evidencias"),{recursive:true});
  writeFileSync(join(dir,"evidencias/job.json"),JSON.stringify({status:"conferida",revisado_em:a.revisado_em}));
  return a;
}
