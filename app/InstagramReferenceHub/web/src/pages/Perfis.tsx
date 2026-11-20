import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Heart, Images, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from "react";
import "../perfis.css";
import { act, api, media, navigate, useApi } from "../lib";
import { Button, ButtonLink, Chip, Empty, ErrorState, IconButton, Modal, PageHeader, Segmented, Skeleton, cx } from "../ui";

type Uso = "inspiracao" | "analise" | "referencia";
const USOS: { value: Uso; label: string; dica: string }[] = [
  { value: "inspiracao", label: "Inspiração", dica: "estética, formato, jeito de falar" },
  { value: "analise", label: "Análise", dica: "estudar o que performa e por quê" },
  { value: "referencia", label: "Referência", dica: "modelar roteiro, hook e CTA" },
];
type Ordem = "views" | "curtidas" | "comentarios" | "engajamento";
const ORDENS: { value: Ordem; label: string; rotulo: string }[] = [
  { value: "views", label: "Mais vistos", rotulo: "views" },
  { value: "curtidas", label: "Mais curtidos", rotulo: "curtidas" },
  { value: "comentarios", label: "Mais comentados", rotulo: "comentários" },
  { value: "engajamento", label: "Mais engajados", rotulo: "curtidas + comentários" },
];
const OBJ: Record<string, string> = {
  venda: "Venda", seguir: "Seguir", engajamento: "Engajamento", compartilhar: "Compartilhar", salvar: "Salvar", autoridade: "Autoridade",
};
const TIPO: Record<string, string> = { reel: "Reel", carrossel: "Carrossel", foto: "Foto" };
const PASSO = 24;

interface Resumo {
  handle: string; url: string; nome: string | null; quem: string | null; analisado: boolean; coletado_em: string | null;
  recorte: { de: string; ate: string } | null; metricas: any; posts: number; capa: string | null;
  objetivo_top: { objetivo: string; n: number } | null; hook_med_s: number | null; usos: Uso[]; nota: string;
}
type Citacao = { texto: string; curtidas?: number; respostas?: number; code?: string };
type Categoria = { id: string; nome: string; descricao: string; n: number; pct: number; posts: number; exemplos: Citacao[] };
type Expressao = { expressao: string; n: number; posts: number; exemplos: Citacao[] };
type Audiencia = {
  base?: { posts: number; de: number; comentarios: number };
  blocos?: Partial<Record<"objecoes" | "duvidas" | "dores_desejos", { total: number; categorias: Categoria[] }>>;
  expressoes?: Expressao[];
};
type Ficha = {
  legenda: string; fala: [number, string][]; comentarios: Citacao[]; comentarios_dono?: string[]; total_comentarios?: number;
  itens?: Partial<Record<"duvidas" | "objecoes" | "dores_desejos" | "frases", Citacao[]>>; expressoes?: string[];
};

const n = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `${Math.round(v / 1e3).toLocaleString("pt-BR")} mil` : String(v);
const inteiro = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
const dec = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
const dataBR = (s?: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
const tempo = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ativar = (fn: () => void) => (e: RKeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };

function Kpi({ label, v, sub, sm }: { label: string; v: string; sub?: string; sm?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] tracking-wide text-ink-3 uppercase">{label}</div>
      <div className={`num mt-1 leading-none font-semibold whitespace-nowrap text-ink ${sm ? "text-[20px]" : "text-[26px]"}`}>{v}</div>
      {sub && <div className="mt-1.5 text-[11px] leading-snug text-ink-3">{sub}</div>}
    </div>
  );
}

function UsoToggle({ p }: { p: Resumo }) {
  const alternar = (u: Uso) => {
    const usos = p.usos.includes(u) ? p.usos.filter((x) => x !== u) : [...p.usos, u];
    act(() => api(`/api/perfis/${p.handle}`, { method: "PATCH", json: { usos } }));
  };
  // Os chips ficam dentro do cartão clicável: o clique neles não abre o perfil.
  return (
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {USOS.map((u) => <Chip key={u.value} active={p.usos.includes(u.value)} onClick={() => alternar(u.value)}>{u.label}</Chip>)}
    </div>
  );
}

// ---------------------------------------------------------------- lista

export function Perfis({ uso }: { uso: Uso | null }) {
  const { data, error, reload } = useApi<Resumo[]>("/api/perfis");
  const [novo, setNovo] = useState("");
  const [usosNovo, setUsosNovo] = useState<Uso[]>([]);
  const lista = useMemo(() => (data ?? []).filter((p) => !uso || p.usos.includes(uso)), [data, uso]);
  const setUso = (u: Uso | null) => navigate(u ? `/perfis?uso=${u}` : "/perfis", { replace: true });

  const adicionar = async () => {
    if (!novo.trim()) return;
    const r = await act(() => api<Resumo>("/api/perfis", { json: { handle: novo, usos: usosNovo } }), "Perfil adicionado");
    if (r) { setNovo(""); setUsosNovo([]); }
  };

  if (error && !data) return <div><PageHeader title={<>Perfis</>} /><ErrorState title="Não deu para ler os perfis" detail={error} onRetry={reload} /></div>;
  const conta = (u: Uso) => (data ?? []).filter((p) => p.usos.includes(u)).length;

  return (
    <div>
      <PageHeader
        title={<>Perfis do <em>Instagram</em></>}
        meta={data ? `${data.length} perfis · ${data.filter((p) => p.analisado).length} analisados` : "Carregando…"}
      />

      <div className="mb-6 rounded-r3 border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input className="field max-w-[300px] flex-1" value={novo} onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adicionar()} placeholder="@perfil ou link do Instagram" aria-label="Perfil para adicionar" />
          <div className="flex flex-wrap gap-1.5">
            {USOS.map((u) => (
              <Chip key={u.value} active={usosNovo.includes(u.value)}
                onClick={() => setUsosNovo((s) => (s.includes(u.value) ? s.filter((x) => x !== u.value) : [...s, u.value]))}>{u.label}</Chip>
            ))}
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={14} aria-hidden />} onClick={adicionar} disabledReason={novo.trim() ? undefined : "Digite um perfil"}>Adicionar</Button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
          Perfil adicionado entra como “aguardando análise”. A análise (todos os posts do recorte: vídeo, transcrição, roteiro, comentários e o que o público diz) roda no AnaliseInstagram e aparece aqui sozinha.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        <Chip active={!uso} onClick={() => setUso(null)}>Todos <span className="num text-[11px] opacity-70">{data?.length ?? 0}</span></Chip>
        {USOS.map((u) => (
          <Chip key={u.value} active={uso === u.value} onClick={() => setUso(uso === u.value ? null : u.value)}>
            {u.label} <span className="num text-[11px] opacity-70">{conta(u.value)}</span>
          </Chip>
        ))}
        {uso && <span className="ml-2 text-[12px] text-ink-3">{USOS.find((u) => u.value === uso)?.dica}</span>}
      </div>

      {!data && <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} ratio="5/2" />)}</div>}
      {data && !lista.length && (
        <Empty title={uso ? <>Nenhum perfil em <em>{USOS.find((u) => u.value === uso)?.label}</em></> : <>Nenhum <em>perfil</em> ainda</>}
          action={uso ? <Button onClick={() => setUso(null)}>Ver todos</Button> : undefined}>
          Adicione um @ acima e marque para que ele serve.
        </Empty>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {lista.map((p) => {
          const abrir = () => navigate(`/perfis/${p.handle}`);
          return (
            <li key={p.handle} className="min-w-0">
              <article className="pf-card" role="link" tabIndex={0} aria-label={`Abrir @${p.handle}`} onClick={abrir} onKeyDown={ativar(abrir)}>
                <div className="pf-card-capa">{p.capa && <img src={media(p.capa)} alt="" loading="lazy" />}</div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="min-w-0">
                    <div className="pf-card-h">@{p.handle}</div>
                    <div className="mt-0.5 truncate text-[12px] text-ink-2">{p.quem ?? (p.analisado ? "" : "Aguardando análise")}</div>
                  </div>
                  {p.analisado && (
                    <div className="grid grid-cols-3 gap-3">
                      {p.metricas?.med_views != null ? <Kpi sm label="Views" v={n(p.metricas?.med_views)} sub="mediana" /> : <Kpi sm label="Carrosséis" v={String(p.metricas?.carrosseis ?? "—")} sub={`de ${p.metricas?.posts}`} />}
                      <Kpi sm label="Curtidas" v={n(p.metricas?.med_curtidas)} sub="mediana" />
                      <Kpi sm label="Coment." v={n(p.metricas?.med_comentarios)} sub="mediana" />
                    </div>
                  )}
                  {p.analisado && (
                    <div className="text-[12px] leading-relaxed text-ink-2">
                      {p.metricas?.posts} posts no recorte · {dec(p.metricas?.por_dia)}/dia
                      {p.objetivo_top && <> · mais comum: <b className="font-medium text-ink">{OBJ[p.objetivo_top.objetivo] ?? p.objetivo_top.objetivo}</b></>}
                      {p.hook_med_s != null && <> · hook ~{dec(p.hook_med_s)} s</>}
                    </div>
                  )}
                  <div className="mt-auto"><UsoToggle p={p} /></div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- detalhe: blocos

function Barras({ itens, total, rotulo }: { itens: { k: string; n: number; extra?: string }[]; total?: number; rotulo?: (k: string) => string }) {
  const max = total ?? Math.max(1, ...itens.map((i) => i.n));
  return (
    <ul className="pf-barras">
      {itens.map((i) => (
        <li key={i.k}>
          <span className="k" title={rotulo ? rotulo(i.k) : i.k}>{rotulo ? rotulo(i.k) : i.k}</span>
          <span className="b"><span style={{ width: `${Math.max(2, Math.round((i.n / max) * 100))}%` }} /></span>
          <span className="v">{i.n}{i.extra === "%" ? "%" : i.extra ? <small> · {i.extra}</small> : null}</span>
        </li>
      ))}
    </ul>
  );
}

function Citacoes({ itens, abrirPost, passo = 8 }: { itens: Citacao[]; abrirPost?: (code: string) => void; passo?: number }) {
  const [ver, setVer] = useState(passo); // quem chama troca a `key` quando a lista muda: volta ao começo
  if (!itens.length) return <p className="mt-3 text-[13px] text-ink-3">Nada aqui.</p>;
  return (
    <>
      <ul className="pf-quotes">
        {itens.slice(0, ver).map((c, i) => (
          <li key={i} className="pf-quote">
            <q>{c.texto}</q>
            <span className="pf-quote-meta">
              {c.curtidas != null && <span className="inline-flex items-center gap-1"><Heart size={11} aria-hidden /> {inteiro(c.curtidas)}</span>}
              {!!c.respostas && <span>{inteiro(c.respostas)} respostas</span>}
              {c.code && abrirPost && <button type="button" onClick={() => abrirPost(c.code!)}>ver o post</button>}
            </span>
          </li>
        ))}
      </ul>
      {itens.length > ver && <button type="button" className="pf-mais" onClick={() => setVer((v) => v + passo * 2)}>Mostrar mais {Math.min(passo * 2, itens.length - ver)} de {itens.length - ver}</button>}
    </>
  );
}

type AbaAud = "objecoes" | "duvidas" | "dores_desejos" | "expressoes";
const ABA_AUD: Record<AbaAud, { label: string; vazio: string }> = {
  objecoes: { label: "Objeções", vazio: "Nenhuma objeção apareceu nos comentários lidos." },
  duvidas: { label: "Dúvidas", vazio: "Nenhuma dúvida apareceu nos comentários lidos." },
  dores_desejos: { label: "Dores e desejos", vazio: "Ninguém contou dor ou desejo nos comentários lidos." },
  expressoes: { label: "Como o público fala", vazio: "Sem expressões repetidas o bastante." },
};

/** O que a audiência diz, de todos os posts lidos: categorias com o comentário escrito do jeito que veio. */
function Publico({ aud, lp, abrirPost }: { aud: Audiencia | null; lp: any; abrirPost: (code: string) => void }) {
  const abas = (Object.keys(ABA_AUD) as AbaAud[]).filter((k) => (k === "expressoes" ? aud?.expressoes?.length : aud?.blocos?.[k]?.categorias?.length));
  const [aba, setAba] = useState<AbaAud>(abas[0] ?? "objecoes");
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => setSel(null), [aba]);
  const det = useRef<HTMLDivElement>(null);
  // No celular a lista vem antes dos comentários: escolher uma categoria desce até eles.
  const escolher = (id: string) => {
    setSel(id);
    if (window.innerWidth < 1000) requestAnimationFrame(() => det.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (!aud?.blocos) {
    // Perfil ainda no formato antigo (só o top 30): mostra o que existe e avisa.
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="pf-bloco"><h3>Dúvidas da audiência</h3><Citacoes itens={(lp?.duvidas ?? []).map((t: string) => ({ texto: t }))} /></div>
        <div className="pf-bloco"><h3>Objeções</h3><Citacoes itens={(lp?.objecoes ?? []).map((t: string) => ({ texto: t }))} /></div>
        <p className="text-[12px] text-ink-3 md:col-span-2">As categorias de objeção, dúvida, dor e jeito de falar aparecem quando a leitura de todos os posts deste perfil terminar.</p>
      </div>
    );
  }

  const opts = abas.map((k) => ({ value: k, label: ABA_AUD[k].label, n: k === "expressoes" ? aud.expressoes?.length : aud.blocos?.[k]?.total }));
  if (aba === "expressoes") {
    const ex = aud.expressoes ?? [];
    const atual = ex.find((e) => e.expressao === sel) ?? ex[0];
    return (
      <>
        <Segmented label="O que o público diz" value={aba} onChange={setAba} options={opts} className="max-w-full overflow-x-auto" />
        <div className="pf-aud">
          <div>
            <p className="mb-3 text-[13px] leading-relaxed text-ink-2">Expressões que se repetem nos comentários, do jeito que foram escritas. O número é quantos comentários usam cada uma.</p>
            <ul className="pf-expr">
              {ex.map((e) => (
                <li key={e.expressao}><button type="button" className={cx(atual?.expressao === e.expressao && "is-on")} onClick={() => escolher(e.expressao)}>{e.expressao}<span>{e.n}</span></button></li>
              ))}
            </ul>
          </div>
          {atual && (
            <div className="pf-det" ref={det}>
              <h3>“{atual.expressao}”</h3>
              <p className="pf-det-meta">{atual.n} comentários · em {atual.posts} posts</p>
              <Citacoes key={atual.expressao} itens={atual.exemplos} abrirPost={abrirPost} passo={5} />
            </div>
          )}
        </div>
      </>
    );
  }

  const bloco = aud.blocos[aba];
  const cats = bloco?.categorias ?? [];
  const cat = cats.find((c) => c.id === sel) ?? cats[0];
  const max = Math.max(1, ...cats.map((c) => c.n));
  return (
    <>
      <Segmented label="O que o público diz" value={aba} onChange={setAba} options={opts} className="max-w-full overflow-x-auto" />
      {!cats.length ? <p className="mt-4 text-[13px] text-ink-3">{ABA_AUD[aba].vazio}</p> : (
        <div className="pf-aud">
          <ol className="pf-cats">
            {cats.map((c) => (
              <li key={c.id}>
                <button type="button" className={cx("pf-cat", cat?.id === c.id && "is-on", c.id === "outros" && "is-outros")} onClick={() => escolher(c.id)} aria-pressed={cat?.id === c.id}>
                  <span className="pf-cat-nome">{c.nome}</span>
                  <span className="pf-cat-n">{c.n} · {c.pct}%</span>
                  <span className="pf-cat-barra" aria-hidden><span style={{ width: `${Math.max(3, Math.round((c.n / max) * 100))}%` }} /></span>
                </button>
              </li>
            ))}
          </ol>
          {cat && (
            <div className="pf-det" ref={det}>
              <h3>{cat.nome}</h3>
              {cat.descricao && <p className="pf-det-desc">{cat.descricao}</p>}
              <p className="pf-det-meta">{cat.n} comentários ({cat.pct}% das {ABA_AUD[aba].label.toLowerCase()}) · em {cat.posts} posts · do mais curtido ao menos</p>
              <Citacoes key={`${aba}-${cat.id}`} itens={cat.exemplos} abrirPost={abrirPost} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- detalhe: ranking

function CartaoPost({ x, ordem, pos, abrir }: { x: any; ordem: Ordem; pos: number; abrir: () => void }) {
  const r = x.roteiro;
  const big = ordem === "views" ? x.views : ordem === "curtidas" ? x.curtidas : ordem === "comentarios" ? x.comentarios : x.curtidas + x.comentarios;
  const capa = x.capa ?? x.slides_img?.[0];
  return (
    <button type="button" className="pf-post" onClick={abrir} aria-label={`Abrir post #${pos} de ${dataBR(x.data)}`}>
      <span className="pf-post-midia">
        {capa && <img src={media(capa)} alt="" loading="lazy" />}
        <span className="pf-post-pos">#{pos}</span>
        <span className="pf-post-tipo">
          {x.tipo === "carrossel" ? <><Images size={11} aria-hidden /> {x.slides ?? x.slides_img?.length ?? ""}</> : x.tipo === "reel" ? <><Play size={11} aria-hidden /> {x.dur ? `${x.dur}s` : ""}</> : TIPO[x.tipo] ?? x.tipo}
        </span>
        <span className="pf-post-big"><b>{n(big)}</b><small>{ORDENS.find((o) => o.value === ordem)?.rotulo}</small></span>
      </span>
      <span className="pf-post-corpo">
        <span className="pf-post-nums">
          {([x.views != null ? ["views", x.views] : ["slides", x.slides], ["curtidas", x.curtidas], ["coment.", x.comentarios]] as const).map(([k, v]) => (
            <span key={k} className="block"><b>{n(v as number)}</b><small>{k}</small></span>
          ))}
        </span>
        <span className="pf-post-meta">
          <span>{dataBR(x.data)}</span>
          <span>· {TIPO[x.tipo] ?? x.tipo}</span>
          {r?.objetivo && <span className="pf-obj">{OBJ[r.objetivo] ?? r.objetivo}</span>}
        </span>
        <span className="pf-post-hook"><b>{r?.fonte === "slides" ? "Capa: " : "Hook: "}</b>{r?.hook ?? x.gancho ?? "—"}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- ficha do post

function Midia({ x }: { x: any }) {
  const slides: string[] = x.slides_img ?? [];
  const [i, setI] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  if (x.video) return <div className="pf-tela"><video ref={video} src={media(x.video)} poster={media(x.capa)} controls playsInline preload="metadata" /></div>;
  if (slides.length) {
    const ir = (d: number) => setI((v) => Math.min(slides.length - 1, Math.max(0, v + d)));
    return (
      <>
        <div className="pf-tela" tabIndex={0} aria-label="Slides do carrossel (setas para navegar)" onKeyDown={(e) => { if (e.key === "ArrowRight") ir(1); if (e.key === "ArrowLeft") ir(-1); }}>
          <img src={media(slides[i])} alt={`Slide ${i + 1}`} />
          <span className="pf-tela-pos">{i + 1}/{slides.length}</span>
          <button type="button" className="pf-tela-nav esq" onClick={() => ir(-1)} disabled={i === 0} aria-label="Slide anterior"><ChevronLeft size={18} /></button>
          <button type="button" className="pf-tela-nav dir" onClick={() => ir(1)} disabled={i === slides.length - 1} aria-label="Próximo slide"><ChevronRight size={18} /></button>
        </div>
        <div className="pf-pontos" aria-hidden>{slides.map((_, k) => <span key={k} className={cx(k === i && "is-on")} />)}</div>
      </>
    );
  }
  return (
    <div className="pf-tela">
      {x.capa ? <img src={media(x.capa)} alt="" /> : <div className="grid aspect-[4/5] place-items-center text-[12px] text-white/70">Sem mídia baixada</div>}
      {x.tipo === "reel" && <span className="pf-tela-pos">vídeo ainda não baixado</span>}
    </div>
  );
}

type AbaCom = "curtidos" | "duvidas" | "objecoes" | "dores_desejos";

function FichaPost({ handle, code, pos, onClose, onNav }: { handle: string; code: string; pos?: number; onClose: () => void; onNav?: (d: number) => void }) {
  const { data: x, error } = useApi<any>(`/api/perfis/${encodeURIComponent(handle)}/posts/${encodeURIComponent(code)}`);
  const [legInteira, setLegInteira] = useState(false);
  const [abaCom, setAbaCom] = useState<AbaCom>("curtidos");
  useEffect(() => { setLegInteira(false); setAbaCom("curtidos"); }, [code]);
  const f: Ficha | null = x?.ficha ?? null;
  const r = x?.roteiro;
  const co = x?.coment;
  const legenda = f?.legenda ?? "";
  const longa = legenda.length > 600 || legenda.split("\n").length > 9;
  const comAbas = ([
    ["curtidos", "Mais curtidos", f?.comentarios?.length],
    ["duvidas", "Dúvidas", f?.itens?.duvidas?.length ?? co?.duvidas?.length],
    ["objecoes", "Objeções", f?.itens?.objecoes?.length ?? co?.objecoes?.length],
    ["dores_desejos", "Dores e desejos", f?.itens?.dores_desejos?.length],
  ] as const).filter(([, , q]) => q);
  const comItens = (a: AbaCom): Citacao[] => (a === "curtidos" ? f?.comentarios ?? [] : f?.itens?.[a] ?? (co?.[a] ?? []).map((t: string) => ({ texto: t })));
  // ← → trocam de post (fora de campo de texto e do player, que usa as setas para avançar o vídeo).
  useEffect(() => {
    if (!onNav) return;
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest("input, textarea, select, video, .pf-tela")) return;
      if (e.key === "ArrowRight") onNav(1);
      if (e.key === "ArrowLeft") onNav(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onNav]);
  const pularPara = (s: number) => { const v = document.querySelector<HTMLVideoElement>(".pf-tela video"); if (v) { v.currentTime = s; v.play().catch(() => {}); } };

  return (
    <Modal width={1180} onClose={onClose}
      title={
        <span className="flex flex-col gap-1">
          <span className="num text-[11px] tracking-wide text-ink-3">{pos ? `#${pos} · ` : ""}@{handle} · {x ? `${TIPO[x.tipo] ?? x.tipo} · ${dataBR(x.data)}` : "…"}</span>
          <span className="title-serif text-[24px] leading-tight">{r?.hook ? `“${r.hook.length > 90 ? r.hook.slice(0, 90).trimEnd() + "…" : r.hook}”` : "Post"}</span>
        </span>
      }>
      {error && <ErrorState title="Não deu para abrir o post" detail={error} />}
      {!x && !error && <Skeleton ratio="16/9" />}
      {x && (
        <div className="pf-ficha">
          <div className="pf-ficha-midia">
            <Midia key={code} x={x} />
            <div className="pf-ficha-nums">
              {x.views != null && <div><b>{n(x.views)}</b><small>views</small></div>}
              <div><b>{n(x.curtidas)}</b><small>curtidas</small></div>
              <div><b>{n(x.comentarios)}</b><small>comentários</small></div>
              {x.dur ? <div><b>{x.dur}s</b><small>duração</small></div> : x.slides ? <div><b>{x.slides}</b><small>slides</small></div> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink size="sm" href={x.url} external icon={<ExternalLink size={13} aria-hidden />}>Abrir no Instagram</ButtonLink>
              {onNav && (
                <span className="ml-auto inline-flex items-center gap-1">
                  <IconButton label="Post anterior (←)" onClick={() => onNav(-1)}><ChevronLeft size={16} /></IconButton>
                  <IconButton label="Próximo post (→)" onClick={() => onNav(1)}><ChevronRight size={16} /></IconButton>
                </span>
              )}
            </div>
          </div>

          <div className="pf-ficha-txt">
            <section className="pf-ficha-sec">
              <h3>Legenda</h3>
              {legenda ? <>
                <p className={cx("pf-legenda", longa && !legInteira && "is-curta")}>{legenda}</p>
                {longa && <button type="button" className="pf-mais" onClick={() => setLegInteira((v) => !v)}>{legInteira ? "Mostrar menos" : "Ler a legenda inteira"}</button>}
              </> : <p className="text-[13px] text-ink-3">{f ? "Post sem legenda." : "A legenda inteira aparece quando a leitura completa deste perfil terminar."}</p>}
            </section>

            {r && (
              <section className="pf-ficha-sec">
                <h3>Roteiro</h3>
                <dl className="pf-roteiro">
                  <dt>{r.fonte === "slides" ? "Capa" : "Hook"}{r.hook_fim_s ? ` · 0–${dec(r.hook_fim_s)} s` : ""}</dt><dd>{r.hook}</dd>
                  {r.hook_tipo && <><dt>Tipo de hook</dt><dd>{r.hook_tipo}{r.hook_gatilho ? ` — ${r.hook_gatilho}` : ""}</dd></>}
                  {r.body_estrutura?.length > 0 && <><dt>Corpo{r.body_formato ? ` · ${r.body_formato}` : ""}</dt><dd><ol>{r.body_estrutura.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></dd></>}
                  {r.objetivo && <><dt>Objetivo</dt><dd><b className="font-medium">{OBJ[r.objetivo] ?? r.objetivo}</b>{r.objetivo_porque ? ` — ${r.objetivo_porque}` : ""}</dd></>}
                  {(r.cta_fala || r.cta_legenda) && <><dt>Pedido</dt><dd>{[r.cta_fala && `na fala: “${r.cta_fala}”`, r.cta_legenda && `na legenda: “${r.cta_legenda}”`].filter(Boolean).join(" · ")}</dd></>}
                  {r.oferta && <><dt>Oferta</dt><dd>{r.oferta}</dd></>}
                </dl>
              </section>
            )}

            {(f?.fala?.length ?? 0) > 0 ? (
              <section className="pf-ficha-sec">
                <h3>Transcrição · clique numa frase para ir ao trecho</h3>
                <ol className="pf-fala">
                  {f!.fala.map(([s, t], i) => (
                    <li key={i} className={cx(r?.hook_fim_s != null && s < r.hook_fim_s && "is-hook")}>
                      <time>{tempo(s)}</time>
                      {x.video ? <button type="button" onClick={() => pularPara(s)}>{t}</button> : <span>{t}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            ) : r?.body && !(r.fonte === "legenda" && legenda) ? (
              <section className="pf-ficha-sec">
                <h3>{r.fonte === "slides" ? "Texto dos slides" : r.fonte === "legenda" ? "Resto da legenda" : "Transcrição do corpo"}</h3>
                <p className="pf-legenda">{r.body}</p>
              </section>
            ) : null}

            <section className="pf-ficha-sec">
              <h3>Comentários · {inteiro(f?.total_comentarios ?? x.comentarios)} no post{co?.amostra ? ` · ${co.amostra} mais relevantes lidos` : ""}</h3>
              {co?.por_que_comentam && <p className="pf-resumo">{co.por_que_comentam}</p>}
              {co?.temas?.length > 0 && <ul className="pf-temas">{co.temas.map((t: string) => <li key={t}>{t}</li>)}</ul>}
              {co?.tipos?.length > 0 && <div className="mt-4"><Barras itens={co.tipos.slice(0, 6).map((t: any) => ({ k: t.tipo, n: t.pct, extra: "%" }))} total={100} /></div>}
              {comAbas.length > 0 && <>
                <div className="mt-5"><Segmented label="Comentários" size="sm" value={comAbas.some(([k]) => k === abaCom) ? abaCom : comAbas[0][0]} onChange={setAbaCom}
                  options={comAbas.map(([value, label, q]) => ({ value, label, n: q ?? null }))} className="max-w-full overflow-x-auto" /></div>
                <Citacoes key={`${code}-${abaCom}`} itens={comItens(comAbas.some(([k]) => k === abaCom) ? abaCom : comAbas[0][0])} passo={10} />
              </>}
              {!co && !f?.comentarios?.length && <p className="text-[13px] text-ink-3">Comentários deste post ainda não foram lidos.</p>}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- detalhe: página

export function PerfilPage({ handle }: { handle: string }) {
  const { data, error, reload } = useApi<Resumo & { dados: any }>(`/api/perfis/${encodeURIComponent(handle)}`);
  const [escolha, setOrdem] = useState<Ordem | null>(null);
  const [obj, setObj] = useState<string | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [limite, setLimite] = useState(PASSO);
  const [aberto, setAberto] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  useEffect(() => setLimite(PASSO), [escolha, obj, tipo]);

  const d = data?.dados;
  const ordens = ORDENS.filter((o) => d?.ranking?.[o.value]?.length);
  const ordem: Ordem = escolha && ordens.some((o) => o.value === escolha) ? escolha : (ordens[0]?.value ?? "views");
  const codigos: string[] = useMemo(() => {
    if (!d) return [];
    // O ranking de views não tem carrossel nem foto: eles entram depois, por curtidas, para o filtro de tipo funcionar.
    const base: string[] = d.ranking?.[ordem] ?? [];
    const resto = Object.keys(d.posts).filter((c) => !base.includes(c)).sort((a, b) => (d.posts[b].curtidas ?? 0) - (d.posts[a].curtidas ?? 0));
    return [...base, ...resto].filter((c) => d.posts[c] && (!obj || d.posts[c]?.roteiro?.objetivo === obj) && (!tipo || d.posts[c]?.tipo === tipo));
  }, [d, ordem, obj, tipo]);
  const tipos = useMemo(() => {
    const t: Record<string, number> = {};
    for (const x of Object.values<any>(d?.posts ?? {})) t[x.tipo] = (t[x.tipo] ?? 0) + 1;
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }, [d]);

  if (error && !data) return <div><PageHeader title={<>@{handle}</>} /><ErrorState title="Não deu para abrir o perfil" detail={error} onRetry={reload} /></div>;
  if (!data) return <Skeleton ratio="3/1" />;
  const m = data.metricas;
  const lp = d?.leitura_posts;
  const aud: Audiencia | null = d?.audiencia ?? null;
  const total = Object.keys(d?.posts ?? {}).length;
  const remover = async () => { if (await act(() => api(`/api/perfis/${handle}`, { method: "DELETE" }), "Perfil removido")) navigate("/perfis"); };
  // Abrir pelo comentário (público) também funciona fora do filtro atual do ranking.
  const lista = aberto && !codigos.includes(aberto) ? [aberto] : codigos;
  const posAberto = aberto ? lista.indexOf(aberto) : -1;

  return (
    <div>
      <button className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink" onClick={() => navigate("/perfis")}><ArrowLeft size={13} aria-hidden /> Perfis</button>
      <PageHeader
        title={<>@{data.handle}</>}
        meta={data.analisado ? `${data.quem ?? ""} · recorte ${dataBR(data.recorte?.de)} a ${dataBR(data.recorte?.ate)} · coletado ${dataBR(data.coletado_em)}` : "Aguardando análise"}
        actions={<>
          <ButtonLink size="sm" href={data.url} external icon={<ExternalLink size={14} aria-hidden />}>Instagram</ButtonLink>
          {!data.analisado && <Button size="sm" icon={<Trash2 size={14} aria-hidden />} onClick={remover}>Remover</Button>}
        </>}
      />

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start">
        <div className="flex flex-col gap-1.5"><span className="text-[11px] tracking-wide text-ink-3 uppercase">Serve para</span><UsoToggle p={data} /></div>
        <textarea className="field min-h-[60px] flex-1 text-[13px]" placeholder="Nota sua sobre o perfil (o que modelar, o que evitar)…"
          value={nota ?? data.nota} onChange={(e) => setNota(e.target.value)}
          onBlur={() => nota != null && nota !== data.nota && act(() => api(`/api/perfis/${handle}`, { method: "PATCH", json: { nota } }), "Nota salva")} />
      </div>

      {!d && <Empty title={<>Ainda sem <em>análise</em></>}>Rode o AnaliseInstagram para @{data.handle} (<code>todos.py {data.handle}</code>).</Empty>}

      {d && <>
        <div className="pf-kpis">
          {m.med_views != null ? <Kpi label="Views" v={n(m.med_views)} sub="mediana por reel" /> : <Kpi label="Formato" v={m.carrosseis ? `${m.carrosseis}` : String(m.reels)} sub={m.carrosseis ? `carrosséis de ${m.posts}` : "reels"} />}
          <Kpi label="Curtidas" v={n(m.med_curtidas)} sub="mediana" />
          <Kpi label="Comentários" v={n(m.med_comentarios)} sub="mediana" />
          <Kpi label="Posts" v={String(m.posts)} sub={`${dec(m.por_dia)}/dia no recorte`} />
          {lp?.hook_med_s != null && <Kpi label="Hook" v={`${dec(lp.hook_med_s)} s`} sub="duração mediana" />}
          {m.cta?.de > 0 && <Kpi label="Pede comentário" v={`${m.cta.n}`} sub={`de ${m.cta.de} reels · ${n(m.cta.med_com)} vs ${n(m.cta.med_sem)} coment.`} />}
        </div>
        <p className="pf-cobertura">
          Lidos <b>{lp?.lidos ?? 0} de {m.posts} posts</b>
          {aud?.base && <> · <b>{inteiro(aud.base.comentarios)} comentários</b> de {aud.base.posts} posts</>}
          {(lp?.lidos ?? 0) < m.posts && " · a leitura dos posts que faltam está em andamento"}
        </p>

        <section className="pf-sec">
          <header className="pf-sec-h">
            <div>
              <h2>O que o público diz</h2>
              <p>Objeções, dúvidas, dores e o jeito de falar da audiência, agrupados por assunto a partir dos comentários de todos os posts lidos. Clique numa categoria para ler os comentários como foram escritos.</p>
            </div>
          </header>
          <Publico aud={aud} lp={lp} abrirPost={setAberto} />
        </section>

        {lp?.lidos > 0 && (
          <section className="pf-sec">
            <header className="pf-sec-h"><div><h2>Como os posts funcionam</h2><p>Leitura de {lp.lidos} posts: para que servem, como abrem, o que pedem e como o público comenta.</p></div></header>
            <div className="pf-blocos">
              <div className="pf-bloco"><h3>Objetivo <small>{lp.lidos} posts</small></h3>
                <Barras itens={lp.objetivos.map((o: any) => ({ k: o.objetivo, n: o.n, extra: o.med_views != null ? `${n(o.med_views)} views` : `${n(o.med_com)} coment.` }))} rotulo={(k) => OBJ[k] ?? k} /></div>
              <div className="pf-bloco"><h3>Tipo de hook</h3><Barras itens={lp.hooks.slice(0, 7).map((h: any) => ({ k: h.tipo, n: h.n }))} /></div>
              <div className="pf-bloco"><h3>O que pedem</h3><Barras itens={lp.pede.slice(0, 7).map((h: any) => ({ k: h.acao, n: h.n }))} /></div>
              {lp.com_coment > 0 && <div className="pf-bloco"><h3>Tipo de comentário <small>{lp.com_coment} posts</small></h3>
                <Barras itens={lp.coment_tipos.slice(0, 7).map((t: any) => ({ k: t.tipo, n: t.pct, extra: "%" }))} total={100} /></div>}
            </div>
          </section>
        )}

        <section className="pf-sec">
          <header className="pf-sec-h">
            <div><h2>Ranking dos posts</h2><p>{total} posts. Clique num post para ver o vídeo ou os slides, a legenda, a transcrição e os comentários.</p></div>
            <Segmented label="Ordenar" size="sm" value={ordem} onChange={setOrdem} options={ordens.map(({ value, label }) => ({ value, label }))} />
          </header>
          <div className="pf-filtros">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!obj} onClick={() => setObj(null)}>Todos os objetivos</Chip>
              {(lp?.objetivos ?? []).map((o: any) => <Chip key={o.objetivo} active={obj === o.objetivo} onClick={() => setObj(obj === o.objetivo ? null : o.objetivo)}>{OBJ[o.objetivo] ?? o.objetivo} <span className="num text-[11px] opacity-70">{o.n}</span></Chip>)}
            </div>
            {tipos.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {tipos.map(([t, q]) => <Chip key={t} active={tipo === t} onClick={() => setTipo(tipo === t ? null : t)}>{TIPO[t] ?? t} <span className="num text-[11px] opacity-70">{q}</span></Chip>)}
              </div>
            )}
          </div>
          {!codigos.length && <Empty title={<>Nenhum post nesse <em>filtro</em></>} />}
          <ul className="pf-grade">
            {codigos.slice(0, limite).map((c, i) => <li key={c} className="min-w-0"><CartaoPost x={d.posts[c]} ordem={ordem} pos={i + 1} abrir={() => setAberto(c)} /></li>)}
          </ul>
          {codigos.length > limite && (
            <div className="mt-6 flex justify-center">
              <Button onClick={() => setLimite((l) => l + PASSO)}>Mostrar mais {Math.min(PASSO, codigos.length - limite)} · faltam {codigos.length - limite}</Button>
            </div>
          )}
          <p className="mt-8 max-w-[80ch] text-[12px] leading-relaxed text-ink-3">{d.metodo}</p>
        </section>
      </>}

      {aberto && d?.posts?.[aberto] && (
        <FichaPost handle={data.handle} code={aberto} pos={codigos.includes(aberto) ? posAberto + 1 : undefined} onClose={() => setAberto(null)}
          onNav={lista.length > 1 ? (dl) => setAberto(lista[(posAberto + dl + lista.length) % lista.length]) : undefined} />
      )}
    </div>
  );
}
