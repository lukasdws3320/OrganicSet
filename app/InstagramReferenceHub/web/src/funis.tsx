import {
  CheckCheck, CircleDashed, Clapperboard, ExternalLink, FileText, FolderOpen, Image as ImageIcon, Link, ListChecks, Megaphone, MessageCircle,
  Monitor, Phone, Search, Send, ShoppingCart, Smartphone, StickyNote, TrendingUp, UserRound, type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ETAPAS, SWIPES, type Conexao, type Etapa, type Funil, type Swipe, type TipoEtapa, type TipoSwipe } from "../../server/funis-tipos";
import { act, api, media, refsUrl, store, useApi, useStore } from "./lib";
import { Button, Empty, ErrorState, Modal, Segmented, Skeleton, cx } from "./ui";

export { ETAPAS, SWIPES };
export type { Conexao, Etapa, Funil, Swipe, TipoEtapa, TipoSwipe };

// ---------- tipos da API (etapa com vínculos resolvidos) ----------

type Ausente = { ausente: true };
/** Resumo de uma página do vault: capa e arquivo principal já como URL /vault/… */
export type VaultResumo = { rel: string; nome: string; capa: string | null; entrada: string | null; arquivos: number; imagens: number; ausente: boolean };
export type RefInfo = { id: string; username: string | null; legenda: string; url: string | null; capa: string | null } | ({ id: string } & Ausente);
export type SwipeInfo = { id: string; tipo: TipoSwipe; titulo: string; texto: string; autor: string; url: string; imagem: string | null; vault: VaultResumo | null } | ({ id: string } & Ausente);
export type ProducaoInfo = {
  id: string; tipo: "video" | "carrossel"; titulo: string; perfil: string | null; etapa: string; hub_url: string | null;
  capa: string | null; video: string | null; slides: string[]; legenda: string | null; post_url: string | null; postado_em: string | null;
};
export type EtapaApi = Etapa & { ref_info?: RefInfo | null; swipe_info?: SwipeInfo | null; vault_info?: VaultResumo | null; producao_info?: ProducaoInfo | ({ id: string } & Ausente) | null };
export const producaoOk = (p: EtapaApi["producao_info"]) => (p && !isAusente(p) ? (p as ProducaoInfo) : null);
export type FunilApi = Omit<Funil, "etapas"> & { etapas: EtapaApi[] };
export type SwipeApi = Swipe & { imagem_url: string | null; capa_url: string | null; vault_info: VaultResumo | null };
export type ArquivoPagina = { rel: string; nome: string; tipo: "html" | "mhtml" | "pdf" };
export type PaginaVault = {
  rel: string; nome: string; grupo: string; fonte: "referencias" | "swipe" | "trabalho";
  tipo: "pagina" | "quiz" | "checkout" | "upsell" | "advertorial" | "outro"; capa: string | null; entrada: string | null; abrir: string;
  arquivos: ArquivoPagina[]; imagens: string[];
};
export type Perfil = { slug: string; name: string };

/** URL /vault/… (o Hub serve a página por http, em sandbox) a partir do caminho relativo do vault. */
export const vaultUrl = (rel: string | null | undefined) => (rel ? `/vault/${rel.split("/").map(encodeURIComponent).join("/")}` : null);
export const vaultCapa = vaultUrl;
export const isAusente = (x: object | null | undefined): boolean => !!x && "ausente" in x && !!(x as { ausente?: boolean }).ausente;
export const swipeOk = (s: SwipeInfo | null | undefined) => (s && !isAusente(s) ? (s as Exclude<SwipeInfo, Ausente>) : null);

// ---------- etapas: rótulo, cor, ícone, que vínculo faz sentido ----------

export const ICONE: Record<TipoEtapa, LucideIcon> = {
  anuncio: Megaphone, post: Clapperboard, story: CircleDashed, comentario: MessageCircle, dm: Send, whatsapp: Phone,
  bio: UserRound, link: Link, pagina: FileText, quiz: ListChecks, checkout: ShoppingCart, upsell: TrendingUp, obrigado: CheckCheck, nota: StickyNote,
};
export const ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.tipo, e])) as Record<TipoEtapa, (typeof ETAPAS)[number]>;

/** Etapas que são um post/vídeo (vínculo com a biblioteca) e etapas que são uma página (vínculo com swipe de página ou vault). */
export const E_POST = new Set<TipoEtapa>(["post", "anuncio", "story"]);
export const E_PAGINA = new Set<TipoEtapa>(["pagina", "quiz", "checkout", "upsell", "obrigado"]);
export const E_CONVERSA = new Set<TipoEtapa>(["comentario", "dm", "whatsapp"]);
export const E_PERFIL = new Set<TipoEtapa>(["bio", "link"]);

/** O que o campo "texto" significa em cada etapa. */
export const TEXTO_LABEL: Partial<Record<TipoEtapa, { label: string; ph: string }>> = {
  post: { label: "Gancho / o que o post fala", ph: "Ex.: 3 receitas sem açúcar que…" },
  anuncio: { label: "Gancho do anúncio", ph: "Ex.: Você não precisa cortar o pão…" },
  story: { label: "O que o story mostra", ph: "Ex.: caixinha de perguntas + link" },
  comentario: { label: "O que a pessoa comenta", ph: "Ex.: RECEITA" },
  dm: { label: "Mensagem que recebe", ph: "Ex.: Oi! Aqui está o link da receita…" },
  whatsapp: { label: "Abordagem", ph: "Ex.: SDR chama em até 5 min com o script X" },
  bio: { label: "Texto da bio", ph: "Ex.: Nutri • 10 anos • Clique no link 👇" },
  link: { label: "Destinos do link", ph: "Ex.: Linktree com 3 botões: PV, quiz, WhatsApp" },
  pagina: { label: "Promessa / estrutura", ph: "Ex.: VSL de 12 min + oferta R$ 97" },
  quiz: { label: "Perguntas e resultado", ph: "Ex.: 7 perguntas → diagnóstico → oferta" },
  checkout: { label: "Oferta", ph: "Ex.: R$ 97 à vista ou 12x" },
  upsell: { label: "Oferta", ph: "Ex.: Plano 90 dias R$ 147" },
  obrigado: { label: "Entrega", ph: "Ex.: acesso por e-mail + grupo" },
  nota: { label: "Nota", ph: "" },
};

/** Qual seção do swipe combina com a etapa. */
export const SWIPE_DA_ETAPA: Partial<Record<TipoEtapa, TipoSwipe>> = {
  dm: "dm", comentario: "dm", whatsapp: "dm", bio: "bio", link: "bio", pagina: "pagina", checkout: "pagina", upsell: "pagina", obrigado: "pagina", quiz: "quiz",
};

/** Sugestão de próxima etapa quando se clica na bolinha de saída. */
export const PROXIMAS: Partial<Record<TipoEtapa, TipoEtapa[]>> = {
  post: ["comentario", "dm", "bio", "link", "pagina"], anuncio: ["pagina", "quiz", "dm", "whatsapp", "checkout"], story: ["dm", "link", "pagina"],
  comentario: ["dm", "whatsapp"], dm: ["link", "pagina", "quiz", "whatsapp", "checkout"], whatsapp: ["checkout", "pagina"],
  bio: ["link", "pagina", "whatsapp"], link: ["pagina", "quiz", "whatsapp", "checkout"], pagina: ["checkout", "quiz", "whatsapp"],
  quiz: ["pagina", "checkout"], checkout: ["upsell", "obrigado"], upsell: ["obrigado", "upsell"],
};

// ---------- geometria ----------

export type Tam = { w: number; h: number };
/** Tamanho padrão (antes de medir) e da miniatura. */
export const NODE_W = 220;
export const NODE_H = 88;
export const TAM_PADRAO: Tam = { w: NODE_W, h: NODE_H };

export function caminho(a: { x: number; y: number }, b: { x: number; y: number }, ta: Tam = TAM_PADRAO, tb: Tam = TAM_PADRAO) {
  const x1 = a.x + ta.w, y1 = a.y + Math.min(ta.h / 2, 44), x2 = b.x, y2 = b.y + Math.min(tb.h / 2, 44);
  const k = Math.max(60, Math.abs(x2 - x1) / 2);
  return { d: `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
}

export function caixa(etapas: { id?: string; x: number; y: number }[], margem = 40, tam?: (id: string | undefined) => Tam) {
  if (!etapas.length) return { x: 0, y: 0, w: NODE_W + margem * 2, h: NODE_H + margem * 2 };
  const t = (e: { id?: string }) => tam?.(e.id) ?? TAM_PADRAO;
  const x = Math.min(...etapas.map((e) => e.x)) - margem, y = Math.min(...etapas.map((e) => e.y)) - margem;
  return { x, y, w: Math.max(...etapas.map((e) => e.x + t(e).w)) + margem - x, h: Math.max(...etapas.map((e) => e.y + t(e).h)) + margem - y };
}

/** Soma dos percentuais que saem de cada etapa (só quando algum foi informado). */
export function distribuicao(conexoes: Conexao[]) {
  const m = new Map<string, number>();
  for (const c of conexoes) if (c.percentual != null) m.set(c.de, (m.get(c.de) ?? 0) + c.percentual);
  return m;
}

// ---------- miniatura (cards da lista) ----------

export function MiniFunil({ funil, className }: { funil: FunilApi; className?: string }) {
  const b = caixa(funil.etapas, 30);
  const pos = new Map(funil.etapas.map((e) => [e.id, e]));
  if (!funil.etapas.length) return <div className={cx("funil-mini funil-mini--vazio", className)}><span>Sem etapas ainda</span></div>;
  return (
    <svg className={cx("funil-mini", className)} viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {funil.conexoes.map((c) => {
        const a = pos.get(c.de), z = pos.get(c.para);
        return a && z ? <path key={c.id} d={caminho(a, z).d} className="funil-mini-linha" /> : null;
      })}
      {funil.etapas.map((e) => (
        <g key={e.id}>
          <rect x={e.x} y={e.y} width={NODE_W} height={NODE_H} rx={14} className="funil-mini-no" />
          <rect x={e.x} y={e.y} width={10} height={NODE_H} rx={5} fill={ETAPA[e.tipo].cor} />
          <text x={e.x + 26} y={e.y + 52} className="funil-mini-txt">{(e.titulo || ETAPA[e.tipo].label).slice(0, 16)}</text>
        </g>
      ))}
    </svg>
  );
}

export function EtapaChip({ tipo }: { tipo: TipoEtapa }) {
  const I = ICONE[tipo];
  return (
    <span className="funil-tipo" style={{ ["--c" as string]: ETAPA[tipo].cor }}>
      <I size={12} strokeWidth={1.75} aria-hidden />{ETAPA[tipo].label}
    </span>
  );
}

// ---------- visualizador de página (vault ou link) ----------

type Alvo = { vault?: string | null; url?: string | null; titulo?: string; acoes?: ReactNode };

/**
 * Mostra a página de verdade dentro do Hub: o HTML salvo (por http, em sandbox), a etapa do quiz em MHTML convertida,
 * o PDF ou as capturas em imagem. Página só com link externo abre num iframe (alguns sites recusam ser embutidos).
 */
export function PaginaViewer({ vault, url, titulo, acoes, onClose }: Alvo & { onClose: () => void }) {
  const { data: p, error } = useApi<PaginaVault>(vault ? `/api/vault/pagina?p=${encodeURIComponent(vault)}` : null);
  const [sel, setSel] = useState<string | "capturas" | "link" | null>(null);
  const [disp, setDisp] = useState<"celular" | "desktop">("celular");
  const atual = sel ?? (p ? (p.entrada ?? (p.imagens.length ? "capturas" : null)) : url ? "link" : null);
  useEffect(() => { setSel(null); }, [vault]);
  const fonte = atual === "link" ? url : atual && atual !== "capturas" ? vaultUrl(atual) : null;
  const arquivos = p?.arquivos ?? [];
  const curto = nomesCurtos(arquivos.map((a) => a.nome.split("/").pop() ?? a.nome));
  useEffect(() => { viewersAbertos.set((n) => n + 1); return () => viewersAbertos.set((n) => n - 1); }, []);
  // Enquanto a página não termina de carregar, aviso no lugar do branco; passando de 10 s, sugere a nova aba.
  const [carregando, setCarregando] = useState<"sim" | "demorando" | "nao">("sim");
  useEffect(() => {
    if (!fonte || atual === "capturas") return;
    setCarregando("sim");
    const t = setTimeout(() => setCarregando((c) => (c === "sim" ? "demorando" : c)), 10000);
    return () => clearTimeout(t);
  }, [fonte, atual, disp]);

  return (
    <Modal title={titulo ?? p?.nome ?? "Página"} onClose={onClose} width={1180}>
      <div className="funil-viewer">
        <aside className="funil-viewer-lado">
          {(arquivos.length > 1 || (p && p.imagens.length > 0) || (url && p)) && (
            <ul className="flex flex-col gap-0.5">
              {arquivos.map((a, i) => (
                <li key={a.rel}>
                  <button type="button" className={cx("funil-viewer-item", atual === a.rel && "is-on")} onClick={() => setSel(a.rel)} title={a.nome}>
                    <FileText size={13} strokeWidth={1.6} aria-hidden /><span className="truncate">{curto[i]}</span>
                    <span className="num ml-auto text-[10px] text-ink-3 uppercase">{a.tipo}</span>
                  </button>
                </li>
              ))}
              {!!p?.imagens.length && (
                <li><button type="button" className={cx("funil-viewer-item", atual === "capturas" && "is-on")} onClick={() => setSel("capturas")}>
                  <ImageIcon size={13} strokeWidth={1.6} aria-hidden /><span>Capturas</span><span className="num ml-auto text-[10px] text-ink-3">{p.imagens.length}</span>
                </button></li>
              )}
              {url && p && (
                <li><button type="button" className={cx("funil-viewer-item", atual === "link" && "is-on")} onClick={() => setSel("link")}>
                  <ExternalLink size={13} strokeWidth={1.6} aria-hidden /><span className="truncate">Link ao vivo</span>
                </button></li>
              )}
            </ul>
          )}
          <div className="mt-auto flex flex-col gap-1.5 pt-3">
            {fonte && <Button size="sm" variant="secondary" icon={<ExternalLink size={13} aria-hidden />} onClick={() => window.open(fonte, "_blank", "noopener")}>Abrir em nova aba</Button>}
            {vault && <Button size="sm" variant="ghost" icon={<FolderOpen size={13} aria-hidden />} onClick={() => act(() => api("/api/vault/abrir", { json: { p: atual && atual !== "capturas" && atual !== "link" ? atual : vault, finder: true } }))}>Mostrar no Finder</Button>}
            {acoes}
          </div>
        </aside>
        <div className="funil-viewer-palco">
          {fonte && atual !== "capturas" && (
            <div className="funil-viewer-barra">
              <Segmented size="sm" label="Tamanho" value={disp} onChange={setDisp} options={[
                { value: "celular", label: "Celular", icon: <Smartphone size={13} aria-hidden /> }, { value: "desktop", label: "Desktop", icon: <Monitor size={13} aria-hidden /> }]} />
              <span className="num min-w-0 truncate text-[11px] text-ink-3">{atual === "link" ? url : (atual ?? "").split("/").slice(-2).join("/")}</span>
            </div>
          )}
          {error && <ErrorState title="Não foi possível ler a página no vault" detail={error} />}
          {!error && vault && !p && <Skeleton ratio="9/16" className="mx-auto w-[300px]" />}
          {atual === "capturas" && p && (
            <div className="funil-viewer-capturas">
              {p.imagens.map((i) => <a key={i} href={vaultUrl(i)!} target="_blank" rel="noopener"><img src={vaultUrl(i)!} alt="" loading="lazy" /></a>)}
            </div>
          )}
          {fonte && atual !== "capturas" && (
            <div className={cx("funil-viewer-moldura", disp === "celular" && "is-celular")}>
              {/* PDF não abre em iframe com sandbox no Chrome; HTML do vault já vem com CSP sandbox do servidor. */}
              {arquivos.find((a) => a.rel === atual)?.tipo === "pdf"
                ? <iframe key={fonte} src={fonte} title={titulo ?? "PDF"} onLoad={() => setCarregando("nao")} />
                : <iframe key={fonte} src={fonte} title={titulo ?? "Página"} sandbox="allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox" onLoad={() => setCarregando("nao")} />}
              {carregando !== "nao" && (
                <div className={cx("funil-viewer-carregando", carregando === "demorando" && "is-demorando")} role="status">
                  <span className="funil-viewer-spin" aria-hidden />
                  <p>Carregando a página…</p>
                  {carregando === "demorando" && fonte && (
                    <p className="text-[12px] text-ink-3">Está demorando. <a href={fonte} target="_blank" rel="noopener" className="underline">Abrir em nova aba</a></p>
                  )}
                </div>
              )}
            </div>
          )}
          {p && !fonte && atual !== "capturas" && (
            <Empty title="Sem página salva nesta captura">A pasta só tem recursos soltos (scripts, fontes), sem o HTML da página. {p.imagens.length ? "Veja as capturas ao lado." : "Abra no Finder para conferir."}</Empty>
          )}
          {atual === "link" && <p className="mt-2 text-center text-[11.5px] text-ink-3">Alguns sites recusam abrir dentro de outra página; se ficar em branco, use “Abrir em nova aba”.</p>}
        </div>
      </div>
    </Modal>
  );
}

/** "CAROL - Efeito lipo Etapa 01.mhtml", "… Etapa 02.mhtml" → "Etapa 01", "Etapa 02": tira o começo comum e a extensão. */
function nomesCurtos(nomes: string[]) {
  const sem = nomes.map((n) => n.replace(/\.(html?|mhtml?|pdf)$/i, ""));
  if (sem.length < 2) return sem;
  let k = 0;
  while (sem.every((n) => n[k] !== undefined && n[k] === sem[0][k])) k++;
  while (k > 0 && /\S/.test(sem[0][k - 1])) k--; // corta em fronteira de palavra
  // Sobrou só número ("01")? Volta uma palavra para ficar "Etapa 01".
  if (sem.every((n) => /^\s*\d+\s*$/.test(n.slice(k)))) {
    k = Math.max(0, sem[0].slice(0, k).trimEnd().lastIndexOf(" ") + 1);
  }
  return sem.map((n) => n.slice(k).trim() || n);
}

/** Capa (print/captura) ou, sem ela, a própria página reduzida dentro de um quadro de celular. */
/** Visualizadores abertos. Com um aberto, as prévias vivas dos cartões saem da tela: cada página viva prende
 *  conexões com o Hub (o navegador abre só 6 por endereço) e a página do visualizador ficava esperando, em branco. */
const viewersAbertos = store(0);

export function PreviaPagina({ capa, entrada, className }: { capa?: string | null; entrada?: string | null; className?: string }) {
  const pausada = useStore(viewersAbertos) > 0;
  if (capa) return <img src={capa} alt="" draggable={false} className={cx("funil-previa", className)} />;
  if (entrada && pausada) return <div className={cx("funil-previa funil-previa--vazia", className)} aria-hidden><FileText size={18} strokeWidth={1.4} /></div>;
  if (entrada) return (
    <div className={cx("funil-previa funil-previa--vivo", className)} aria-hidden>
      <iframe src={entrada} title="" tabIndex={-1} sandbox="allow-scripts" loading="lazy" />
    </div>
  );
  return <div className={cx("funil-previa funil-previa--vazia", className)}><FileText size={18} strokeWidth={1.4} aria-hidden /></div>;
}

// ---------- seletores de vínculo ----------

type RefCard = { id: string; username: string | null; caption: string | null; thumb_path: string | null; legacy_id?: string | null };

const ETAPA_PROD: Record<string, string> = { postado: "Postado", agendado: "Agendado", edicao: "Edição", pronto: "Pronto", publicado: "Postado", a_publicar: "A publicar" };
const dataCurta = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

/** Posts do próprio expert (vídeos da Replicação e carrosséis), o mais recente primeiro. */
function ListaMeusPosts({ expert, onPick }: { expert: string | null; onPick: (id: string) => void }) {
  const { data, loading, error } = useApi<{ itens: ProducaoInfo[] }>(`/api/funis/posts-produzidos${expert ? `?profile=${encodeURIComponent(expert)}` : ""}`);
  const [q, setQ] = useState("");
  const itens = (data?.itens ?? []).filter((p) => !q.trim() || `${p.titulo} ${p.legenda ?? ""} ${p.perfil ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  if (error) return <ErrorState title="Não deu para ler os posts produzidos" detail={error} />;
  return (
    <>
      <label className="relative block">
        <Search size={15} strokeWidth={1.5} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
        <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por REF, legenda ou perfil…" autoFocus />
      </label>
      {!expert && <p className="mt-2 text-[12px] text-ink-3">O funil não tem expert: mostrando os posts de todos. Escolha o expert no topo para filtrar.</p>}
      <div className="mt-4 grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5">
        {loading && !itens.length && Array.from({ length: 10 }, (_, i) => <Skeleton key={i} />)}
        {itens.map((p) => (
          <button key={p.id} type="button" onClick={() => onPick(p.id)} className="funil-pick group text-left">
            <span className="relative block aspect-[9/16] overflow-hidden rounded-r2 bg-media-bg">
              {p.capa ? <img src={p.capa} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.03]" />
                : p.video ? <video src={`${p.video}#t=0.1`} preload="metadata" muted playsInline className="size-full object-cover" aria-hidden /> : null}
              <span className="funil-pick-tag">{p.tipo === "video" ? "Reel" : `Carrossel · ${p.slides.length}`}</span>
            </span>
            <span className="num mt-1 block truncate text-[11px] text-ink-3">{[ETAPA_PROD[p.etapa] ?? p.etapa, dataCurta(p.postado_em)].filter(Boolean).join(" · ")}</span>
            <span className="block truncate text-[12px]">{p.legenda?.split("\n")[0] || p.titulo}</span>
          </button>
        ))}
      </div>
      {!loading && !itens.length && <p className="py-8 text-center text-[13px] text-ink-3">Nenhum post produzido{expert ? " deste expert" : ""} ainda.</p>}
    </>
  );
}

/** Vincular post: os do expert (feitos no Hub) ou uma referência da biblioteca. */
export function PickPost({ expert, onPickProducao, onPickRef, onClose }: {
  expert: string | null; onPickProducao: (id: string) => void; onPickRef: (id: string) => void; onClose: () => void;
}) {
  const [aba, setAba] = useState<"meus" | "biblioteca">("meus");
  return (
    <Modal title="Vincular post" onClose={onClose} width={760}>
      <div className="px-5 pb-5">
        <Segmented label="Origem do post" size="sm" value={aba} onChange={setAba}
          options={[{ value: "meus", label: "Meus posts" }, { value: "biblioteca", label: "Biblioteca de referências" }]} />
        <div className="mt-4">{aba === "meus" ? <ListaMeusPosts expert={expert} onPick={onPickProducao} /> : <ListaRefs onPick={onPickRef} />}</div>
      </div>
    </Modal>
  );
}

export function PickRef({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  return (
    <Modal title="Vincular post da biblioteca" onClose={onClose} width={760}>
      <div className="px-5 pb-5"><ListaRefs onPick={onPick} /></div>
    </Modal>
  );
}

function ListaRefs({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const url = q.trim().length >= 2 ? refsUrl({ q: q.trim() }) : "/api/refs";
  const { data, loading } = useApi<{ items: RefCard[] }>(url);
  const itens = (data?.items ?? []).slice(0, 60);
  return (
      <div>
        <label className="relative block">
          <Search size={15} strokeWidth={1.5} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
          <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por @criador, legenda, REF…" autoFocus />
        </label>
        <div className="mt-4 grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-5">
          {loading && !itens.length && Array.from({ length: 10 }, (_, i) => <Skeleton key={i} />)}
          {itens.map((r) => (
            <button key={r.id} type="button" onClick={() => onPick(r.id)} className="funil-pick group text-left">
              <span className="block aspect-[9/16] overflow-hidden rounded-r2 bg-media-bg">
                {r.thumb_path && <img src={media(r.thumb_path)} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.03]" />}
              </span>
              <span className="num mt-1 block truncate text-[11px] text-ink-3">{r.legacy_id ?? r.id}</span>
              <span className="block truncate text-[12px]">{r.username ? `@${r.username}` : "Sem criador"}</span>
            </button>
          ))}
        </div>
        {!loading && !itens.length && <p className="py-8 text-center text-[13px] text-ink-3">Nada encontrado.</p>}
      </div>
  );
}

function ListaSwipe({ tipo, onPick }: { tipo: TipoSwipe; onPick: (id: string) => void }) {
  const { data } = useApi<{ itens: SwipeApi[] }>(`/api/swipes?tipo=${tipo}`);
  const visual = tipo === "pagina" || tipo === "quiz";
  if (data && !data.itens.length) return <Empty title="Seção vazia">Cadastre em Funis → {SWIPES.find((s) => s.tipo === tipo)!.label}{visual ? " ou use a aba Vault aqui ao lado" : ""}.</Empty>;
  return (
    <ul className={cx("grid max-h-[60vh] gap-3 overflow-y-auto", visual ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-2")}>
      {(data?.itens ?? []).map((s) => (
        <li key={s.id}>
          {visual ? (
            <button type="button" onClick={() => onPick(s.id)} className="funil-pick group block w-full text-left">
              <span className="block aspect-[4/5] overflow-hidden rounded-r2 border border-line bg-media-bg">
                <PreviaPagina capa={s.capa_url} entrada={s.vault_info?.entrada} className="size-full" />
              </span>
              <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug">{s.titulo}</span>
            </button>
          ) : (
            <button type="button" onClick={() => onPick(s.id)} className="funil-pick flex w-full flex-col gap-1.5 rounded-r2 border border-line bg-card p-2.5 text-left hover:border-ink-3">
              <span className="truncate text-[13px] font-medium">{s.titulo}</span>
              <span className={cx(tipo === "dm" ? "funil-dm" : "funil-bio", "!m-0")}>{s.texto || s.autor || "—"}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PickSwipe({ tipo: tipoInicial, onPick, onClose }: { tipo?: TipoSwipe; onPick: (id: string) => void; onClose: () => void }) {
  const [tipo, setTipo] = useState<TipoSwipe>(tipoInicial ?? "dm");
  const titulo = { dm: "Vincular DM do swipe", bio: "Vincular bio do swipe", pagina: "Vincular página do swipe", quiz: "Vincular quiz do swipe" }[tipo];
  return (
    <Modal title={titulo} onClose={onClose} width={760}>
      <div className="px-5 pb-5">
        <Segmented label="Seção do swipe" value={tipo} onChange={setTipo} className="mb-4" options={SWIPES.map((s) => ({ value: s.tipo, label: s.label }))} />
        <ListaSwipe tipo={tipo} onPick={onPick} />
      </div>
    </Modal>
  );
}

function ListaVault({ onPick, tipo }: { onPick: (rel: string) => void; tipo?: string }) {
  const { data } = useApi<PaginaVault[]>("/api/vault/paginas");
  const [q, setQ] = useState("");
  const itens = useMemo(() => {
    const n = q.trim().toLowerCase();
    const xs = (data ?? []).filter((p) => !n || `${p.nome} ${p.grupo}`.toLowerCase().includes(n));
    // Quiz primeiro quando a etapa é quiz; páginas primeiro nas outras.
    return tipo ? [...xs.filter((p) => (tipo === "quiz") === (p.tipo === "quiz")), ...xs.filter((p) => (tipo === "quiz") !== (p.tipo === "quiz"))] : xs;
  }, [data, q, tipo]);
  return (
    <>
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar página capturada…" autoFocus />
      <p className="mt-2 text-[12px] text-ink-3">Só leitura: 05_Biblioteca/04_Paginas/01_paginas, 05_Biblioteca/04_Paginas/02_trabalhos e Swipe › 07 Funis e Páginas Capturadas.</p>
      <div className="mt-3 grid max-h-[56vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-4">
        {!data && Array.from({ length: 8 }, (_, i) => <Skeleton key={i} ratio="4/5" />)}
        {itens.map((p) => (
          <button key={p.rel} type="button" onClick={() => onPick(p.rel)} className="funil-pick group text-left">
            <span className="block aspect-[4/5] overflow-hidden rounded-r2 border border-line bg-media-bg">
              <PreviaPagina capa={vaultUrl(p.capa)} entrada={p.capa ? null : vaultUrl(p.entrada)} className="size-full" />
            </span>
            <span className="mt-1 line-clamp-2 block text-[12px] leading-snug">{p.nome}</span>
            <span className="block truncate text-[11px] text-ink-3">{p.grupo}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function PickVault({ onPick, onClose }: { onPick: (rel: string) => void; onClose: () => void }) {
  return (
    <Modal title="Vincular página do vault" onClose={onClose} width={860}>
      <div className="px-5 pb-5"><ListaVault onPick={onPick} /></div>
    </Modal>
  );
}

/** Uma porta só para vincular página a uma etapa de página: do swipe (Páginas/Quiz) ou direto do vault. */
export function PickPagina({ tipo, onSwipe, onVault, onClose }: { tipo: TipoEtapa; onSwipe: (id: string) => void; onVault: (rel: string) => void; onClose: () => void }) {
  const [aba, setAba] = useState<"vault" | "pagina" | "quiz">(tipo === "quiz" ? "quiz" : "vault");
  return (
    <Modal title={tipo === "quiz" ? "Vincular quiz" : "Vincular página"} onClose={onClose} width={900}>
      <div className="px-5 pb-5">
        <Segmented label="De onde" value={aba} onChange={setAba} className="mb-4" options={[
          { value: "vault", label: "Páginas do vault" }, { value: "pagina", label: "Swipe · Páginas" }, { value: "quiz", label: "Swipe · Quiz" }]} />
        {aba === "vault" ? <ListaVault onPick={onVault} tipo={tipo} /> : <ListaSwipe tipo={aba} onPick={onSwipe} />}
      </div>
    </Modal>
  );
}
