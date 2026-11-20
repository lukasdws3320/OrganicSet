import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  FacetsResponse, Filters, Funnel, Metrics, PipelineItem, PipelineResponse, Profile, PublicPipelineResponse, Stage,
} from "../../server/types";
import { STAGES } from "../../server/types";

// ---------- store mínimo ----------

export function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(v: T | ((p: T) => T)) {
      value = typeof v === "function" ? (v as (p: T) => T)(value) : v;
      subs.forEach((s) => s());
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
export function useStore<T>(s: ReturnType<typeof store<T>>) {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

// ---------- router (History API) ----------

const loc = store({ path: location.pathname, search: location.search, state: history.state as any });
const syncLoc = () => loc.set({ path: location.pathname, search: location.search, state: history.state });
window.addEventListener("popstate", syncLoc);

export function navigate(to: string, opts: { replace?: boolean; state?: unknown } = {}) {
  history[opts.replace ? "replaceState" : "pushState"](opts.state ?? null, "", to);
  syncLoc();
  if (!opts.replace && !to.startsWith("/ref/")) window.scrollTo({ top: 0 });
}
export const useLocation = () => useStore(loc);

/** Local "de fundo": com o visualizador aberto, é a página que estava por trás. */
export function useBgLocation() {
  const l = useLocation();
  if (!l.path.startsWith("/ref/")) return { path: l.path, search: l.search };
  const bg: string = l.state?.bg ?? "/referencias";
  const i = bg.indexOf("?");
  return i < 0 ? { path: bg, search: "" } : { path: bg.slice(0, i), search: bg.slice(i) };
}

/** Abre o visualizador sobre a página atual (a lista continua montada por trás). */
export function openRef(id: string) {
  const cur = loc.get();
  const bg = cur.path.startsWith("/ref/") ? cur.state?.bg ?? "/referencias" : cur.path + cur.search;
  navigate(`/ref/${id}`, { state: { bg }, replace: cur.path.startsWith("/ref/") });
}
export function closeRef() {
  const cur = loc.get();
  if (cur.state?.bg && history.length > 1) history.back();
  else navigate(cur.state?.bg ?? "/referencias");
}

/** IDs do resultado visível: o visualizador navega com ← →. */
export const resultIds = store<string[]>([]);

// ---------- API ----------

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; json?: unknown; body?: BodyInit } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.json !== undefined || opts.body ? "POST" : "GET"),
    headers: opts.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });
  const data = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Erro ${res.status}`, data);
  return data as T;
}

/** Mutação → invalida tudo; as telas abertas recarregam. */
const version = store(0);
export const invalidate = () => version.set((v) => v + 1);

export function useApi<T = any>(path: string | null) {
  const v = useStore(version);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') setTick(t => t + 1); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer); };
  }, [path]);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    // Mantém os dados anteriores na tela enquanto recarrega (sem piscar).
    setState((s) => ({ loading: true, data: last.current === path ? s.data : null, error: last.current === path ? s.error : null }));
    api<T>(path)
      .then((data) => alive && (last.current = path, setState({ data, error: null, loading: false })))
      .catch((e) => alive && setState((s) => ({ ...s, error: e.message, loading: false })));
    return () => { alive = false; };
  }, [path, v, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export const refsUrl = (f: Filters) => `/api/refs?f=${encodeURIComponent(JSON.stringify(f))}`;
export const media = (p: string | null | undefined) => (p ? `/media/${p.split("/").map(encodeURIComponent).join("/")}` : undefined);

// ---------- toasts ----------

export type ToastTone = "ok" | "erro";
export interface ToastItem { id: number; text: string; tone: ToastTone; action?: { label: string; run: () => unknown } }
export const toasts = store<ToastItem[]>([]);
let toastId = 0;
export function dismissToast(id: number) { toasts.set((t) => t.filter((x) => x.id !== id)); }
/** Mostra um aviso curto. `action` vira um botão no toast (ex.: Desfazer). */
export function toast(text: string, tone: ToastTone = "ok", opts: { action?: ToastItem["action"]; ms?: number } = {}) {
  const id = ++toastId;
  toasts.set((t) => [...t.slice(-2), { id, text, tone, action: opts.action }]);
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.action ? 8000 : tone === "erro" ? 6000 : 2600));
  return id;
}
/** Toast com "Desfazer" para ações reversíveis (SPEC §4.12). */
export function toastUndo(text: string, undo: () => unknown, label = "Desfazer") {
  return toast(text, "ok", { action: { label, run: undo } });
}
/** Executa uma ação da API e mostra o erro em toast. Com `undo`, o toast de sucesso oferece Desfazer. */
export async function act<T>(fn: () => Promise<T>, ok?: string, undo?: () => Promise<unknown>): Promise<T | undefined> {
  try {
    const r = await fn();
    if (ok && undo) toastUndo(ok, () => act(undo, "Desfeito"));
    else if (ok) toast(ok);
    invalidate();
    return r;
  } catch (e: any) {
    toast(apiErrorText(e), "erro");
    return undefined;
  }
}
/** Texto de erro honesto: "Hub desligado" só quando a rede falhou; 4xx/5xx mostram código e corpo. */
export function apiErrorText(e: unknown) {
  if (e instanceof ApiError) return e.status ? `Hub respondeu ${e.status}: ${e.message}` : e.message;
  if (e instanceof TypeError) return "Hub desligado: não foi possível conectar";
  return (e as any)?.message ?? String(e);
}

export async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast("Não foi possível copiar", "erro");
  }
}

// ---------- tema ----------

export type Theme = "dark" | "light";
export const theme = store<Theme>((document.documentElement.dataset.theme as Theme) || "dark");
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("irh-theme", t); } catch { /* navegação privada: só a sessão */ }
  theme.set(t);
}

// ---------- formatação PT-BR ----------

const nf = new Intl.NumberFormat("pt-BR");
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : nf.format(n));
export const fmtCompact = (n: number | null | undefined) => (n == null ? "—" : n < 10000 ? nf.format(n) : compact.format(n));

const pad = (n: number) => String(n).padStart(2, "0");
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "Não disponível";
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "Não disponível";
  const d = new Date(iso);
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "hoje", "ontem", "há N dias", "há N meses". */
export function ago(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso), n = new Date();
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 60) return `há ${days} dias`;
  const m = Math.round(days / 30);
  return m < 24 ? `há ${m} meses` : `há ${Math.round(days / 365)} anos`;
}
export function fmtDuration(s: number | null | undefined) {
  if (s == null || !Number.isFinite(s)) return "—";
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
}
export function fmtBytes(b: number | null | undefined) {
  if (b == null) return "Não disponível";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}
export const isStale = (m: Metrics | null) => !!m && ago(m.collected_at) !== "hoje";

export function plural(n: number, one: string, many: string) {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

// ---------- filtros na URL ----------

export function readFilters(search: string): Filters {
  const raw = new URLSearchParams(search).get("f");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
export function filtersSearch(f: Filters) {
  const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && !v.length)));
  return Object.keys(clean).length ? `?f=${encodeURIComponent(JSON.stringify(clean))}` : "";
}

/** Preferência persistida em localStorage. */
export function usePref<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : initial; } catch { return initial; }
  });
  const set = useCallback((x: T) => { setV(x); localStorage.setItem(key, JSON.stringify(x)); }, [key]);
  return [v, set] as const;
}

export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};

// ---------- ciclo (SPEC §3) e API nova (H1) ----------

/** Posição no ciclo: 0 = guardada … 6 = postada. */
export const stageRank = (s: Stage) => STAGES.indexOf(s);
/** Estágio mais avançado de uma lista (regra 9 de §3.2). */
export const maxStage = (list: Stage[]) => list.reduce<Stage>((a, b) => (stageRank(b) > stageRank(a) ? b : a), "guardada");

const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, String(v));
  const t = u.toString();
  return t ? `?${t}` : "";
};

export const apiUrl = {
  refs: refsUrl,
  ref: (id: string) => `/api/refs/${encodeURIComponent(id)}`,
  facets: (todos = false) => `/api/facets${qs({ todos: todos ? 1 : undefined })}`,
  stats: () => "/api/stats",
  profiles: () => "/api/profiles",
  pipeline: (profile?: string | null) => `/api/pipeline${qs({ profile })}`,
  producao: (id: string) => `/api/replicacoes/${encodeURIComponent(id)}/producao`,
  editado: (id: string) => `/api/replicacoes/${encodeURIComponent(id)}/producao/editado`,
};

export type StatsResponse = { funnel?: Funnel; pendencias?: Record<string, number>; [k: string]: unknown };

export const getFacets = (todos = false) => api<FacetsResponse>(apiUrl.facets(todos));
export const getProfiles = () => api<Profile[]>(apiUrl.profiles());
export const getStats = () => api<StatsResponse>(apiUrl.stats());
export const getPipeline = (profile?: string | null) => api<PipelineResponse>(apiUrl.pipeline(profile));
export const getPublicPipeline = (profile: string) => api<PublicPipelineResponse>(`/api/pipeline${qs({ profile, publico: 1 })}`);
/** Só agenda (ISO ou null). Postado continua em PATCH /api/replicacoes/:id. */
/** Agenda. `post` = qual post (variação) da replicação; sem ele, o próximo em aberto. */
export const scheduleItem = (id: string, agendado_para: string | null, post?: string) =>
  api<PipelineItem>(`/api/pipeline/${encodeURIComponent(id)}`, { method: "PATCH", json: { agendado_para, ...(post ? { post } : {}) } });
/** Marca postado com campos opcionais. Data omitida preserva; null remove. `post` = qual variação. */
export const markPosted = (id: string, url: string, postadoEm?: string | null, post?: string) =>
  api(`/api/replicacoes/${encodeURIComponent(id)}`, { method: "PATCH", json: { item: "POSTADO", status: "feito", url, ...(postadoEm !== undefined ? { postadoEm } : {}), ...(post ? { post } : {}) } });
/** Arquivar tira da fila de postagem sem apagar nada; false desarquiva. */
export const archiveItem = (id: string, arquivado = true) =>
  api(`/api/replicacoes/${encodeURIComponent(id)}/arquivar`, { method: "POST", json: { arquivado } });
/** Arquiva com toast "Desfazer". */
export const arquivar = (id: string) => act(() => archiveItem(id), "Arquivado: saiu da fila de postagem", () => archiveItem(id, false));
/** Desfaz a marcação de postado (para o toast "Desfazer"). */
export const unmarkPosted = (id: string, post?: string) =>
  api(`/api/replicacoes/${encodeURIComponent(id)}`, { method: "PATCH", json: { item: "POSTADO", status: "pendente", ...(post ? { post } : {}) } });

/** Post = seção do Postagens.md (fonte única de calendário e publicação). Cada variação é um post. */
export const patchPost = (id: string, b: { publicacao?: "a_publicar" | "postado" | "arquivado"; url?: string | null; postado_em?: string | null; agendado_para?: string | null; canal?: string | null }) =>
  api(`/api/posts/${encodeURIComponent(id)}`, { method: "PATCH", json: b });
export const novoPost = (b: { replicacao: string; versao?: string; canal?: string | null; agendado_para?: string | null }) =>
  api<{ id: string }>("/api/posts", { method: "POST", json: b });
/** Arquiva UM post (variação), com "Desfazer". */
export const arquivarPost = (id: string) =>
  act(() => patchPost(id, { publicacao: "arquivado" }), "Arquivado: saiu da fila de postagem", () => patchPost(id, { publicacao: "a_publicar" }));

/** URL de mídia da biblioteca, inclusive slides (library/slides/<REF>/NN.ext). */
export const slideUrl = (ref: string, file: string) => media(`slides/${ref}/${file}`);
