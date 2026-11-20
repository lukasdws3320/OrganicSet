import { profileAtivo } from "./db";
// Agenda automática: todo post PRONTO (vídeo editado, carrossel pronto, vídeo próprio) ganha data e hora sozinho.
// Meta = N posts por dia em cada perfil (padrão 4). O post entra no primeiro horário livre a partir de agora; dia cheio
// passa para o seguinte. Post pronto com data vencida (não postado) é remarcado do mesmo jeito. Grava na Postagens.md
// (fonte única), com `agenda: auto` e, quando remarcado, `remarcado_de: <data hora antiga>`. Agendar à mão tira a marca.
import type { Database } from "bun:sqlite";
import type { Ctx } from "./refs";
import { getSettings } from "./catalog";
import { atualizarPost, criarPost, geridoPelaNota, lerPostsVault, listarPosts, type PostItem, type RepResumo } from "./posts";

export type AgendaPerfil = { meta: number; horarios: string[]; horariosIA?: string[] };
export type AgendaConfig = AgendaPerfil & { auto: boolean; perfis?: Record<string, AgendaPerfil> };
export type Agendado = { id: string; perfil: string; titulo: string; de: string | null; para: string };

const pad = (n: number) => String(n).padStart(2, "0");
const diaLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutos = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
/** Dois posts no mesmo perfil precisam de pelo menos 1 h entre si. */
const FOLGA_MIN = 60;
/** Hoje só entra horário com pelo menos 30 min pela frente. */
const ANTECEDENCIA_MIN = 30;
const DIAS_A_FRENTE = 120;

export function agendaConfig(ctx: Pick<Ctx, "db" | "root">): AgendaConfig {
  const s = getSettings(ctx as Ctx);
  const meta = Math.max(1, Math.min(12, Number(s.meta_posts_dia) || 4));
  const horarios = String(s.horarios_posts).split(/[,\s]+/).filter((h) => /^\d{1,2}:\d{2}$/.test(h)).map((h) => h.padStart(5, "0")).sort();
  let perfis: Record<string, AgendaPerfil> = {};
  try { perfis = JSON.parse(s.agenda_perfis); } catch {}
  return { perfis, meta, horarios: horarios.length ? horarios : ["09:00", "12:00", "15:00", "18:00", "21:00"], auto: s.agenda_auto !== "0" };
}

type Dia = { n: number; horas: number[]; refs: Set<string> };

/**
 * Plano puro (sem gravar): para cada post pronto sem data futura, o próximo horário livre do perfil.
 * Ocupa o dia: post postado (no dia em que foi ao ar) e post com data de hoje em diante, pronto ou ainda em produção.
 */
export function planejarAgenda(itens: PostItem[], cfg: AgendaConfig, agora = new Date()): Agendado[] {
  const hoje = diaLocal(agora);
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const ocup = new Map<string, Map<string, Dia>>();
  const dia = (perfil: string, d: string) => {
    let m = ocup.get(perfil);
    if (!m) ocup.set(perfil, (m = new Map()));
    let x = m.get(d);
    if (!x) m.set(d, (x = { n: 0, horas: [], refs: new Set() }));
    return x;
  };
  const candidato = (p: PostItem) => p.stage === "pronta" && profileAtivo(p.perfil.slug); // pronto, sem data ou com data vencida
  for (const p of itens) {
    if (p.stage === "arquivada" || candidato(p)) continue;
    const quando = p.stage === "postada" ? (p.postado_em ?? p.agendado_para) : p.agendado_para;
    if (!quando) continue;
    const d = new Date(quando);
    if (diaLocal(d) < hoje) continue;
    const x = dia(p.perfil.slug, diaLocal(d));
    x.n++; x.horas.push(d.getHours() * 60 + d.getMinutes());
    if (p.ref) x.refs.add(p.ref);
  }
  // Ordem: vencidos primeiro (pelo dia antigo), depois os sem data por REF e versão.
  const fila = itens.filter(candidato).sort((a, b) =>
    (a.agendado_para ?? "9999").localeCompare(b.agendado_para ?? "9999")
    || (a.ref ?? "zz").localeCompare(b.ref ?? "zz")
    || (a.versao ?? "").localeCompare(b.versao ?? "", "pt-BR", { numeric: true })
    || a.id.localeCompare(b.id));
  const out: Agendado[] = [];
  for (const p of fila) {
    const perfilCfg = cfg.perfis?.[p.perfil.slug] ?? cfg;
    const horarios = perfilCfg.horariosIA ? perfilCfg.horarios.filter(h => Boolean(p.ref) === perfilCfg.horariosIA!.includes(h)) : perfilCfg.horarios;
    const achar = (mesmoVideoNoDia: boolean) => {
      for (let i = 0; i < DIAS_A_FRENTE; i++) {
        const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + i);
        const dk = diaLocal(d), x = dia(p.perfil.slug, dk);
        if (x.n >= perfilCfg.meta) continue;
        // O mesmo vídeo (outra versão da legenda) não sai duas vezes no mesmo dia, se der para evitar.
        if (!mesmoVideoNoDia && p.ref && x.refs.has(p.ref)) continue;
        for (const h of horarios) {
          const m = minutos(h);
          if (dk === hoje && m < agoraMin + ANTECEDENCIA_MIN) continue;
          if (x.horas.some((o) => Math.abs(o - m) < FOLGA_MIN)) continue;
          return { d, dk, x, m };
        }
      }
      return null;
    };
    const vaga = achar(false) ?? achar(true);
    if (!vaga) continue;
    vaga.x.n++; vaga.x.horas.push(vaga.m);
    if (p.ref) vaga.x.refs.add(p.ref);
    const para = new Date(vaga.d.getFullYear(), vaga.d.getMonth(), vaga.d.getDate(), Math.floor(vaga.m / 60), vaga.m % 60);
    out.push({ id: p.id, perfil: p.perfil.slug, titulo: `${p.ref ?? p.tipo} ${p.versao ?? ""}`.trim(), de: p.agendado_para, para: para.toISOString() });
  }
  return out;
}

/** Replicação pronta (vídeo editado) de perfil com nota e sem nenhum post ainda: ganha o post V1 para entrar na agenda. */
function criarPostsQueFaltam(db: Database, root: string, reps: (RepResumo & { slug?: string | null })[]): string[] {
  const comPost = new Set(lerPostsVault(root).map((p) => p.replicacao).filter(Boolean));
  const criados: string[] = [];
  for (const r of reps) {
    const slug = r.id.split("--")[1];
    if (!profileAtivo(slug) || !slug || r.etapa !== "pronto" || !r.editado || comPost.has(r.id) || !geridoPelaNota(slug)) continue;
    try { criados.push(criarPost(db, root, r.id, { versao: "V1" }).id); } catch { /* perfil sem nota: fica de fora */ }
  }
  return criados;
}

/** Roda a agenda automática e grava na nota. `forcar` ignora o liga/desliga (botão "Planejar agora"). */
export function agendarAutomatico(ctx: Ctx, reps: (RepResumo & { slug?: string | null })[], opts: { forcar?: boolean; agora?: Date } = {}): { criados: string[]; agendados: Agendado[] } {
  const cfg = agendaConfig(ctx);
  if (!cfg.auto && !opts.forcar) return { criados: [], agendados: [] };
  const criados = criarPostsQueFaltam(ctx.db, ctx.root, reps);
  const plano = planejarAgenda(listarPosts(ctx.db, ctx.root, reps, { hoje: diaLocal(opts.agora ?? new Date()) }), cfg, opts.agora);
  const agendados: Agendado[] = [];
  for (const a of plano) {
    try { atualizarPost(a.id, { agendado_para: a.para, auto: { de: a.de } }); agendados.push(a); } catch { /* nota mudou no meio: entra na próxima rodada */ }
  }
  return { criados, agendados };
}
