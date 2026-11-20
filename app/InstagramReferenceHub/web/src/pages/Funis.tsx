import { Eye, FolderOpen, ImageUp, Pencil, Plus, Search, Workflow } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import "../funis.css";
import {
  EtapaChip, MiniFunil, PaginaViewer, PickVault, PreviaPagina, SWIPES, vaultUrl,
  type FunilApi, type PaginaVault, type Perfil, type SwipeApi, type TipoSwipe,
} from "../funis";
import { SUBTIPOS_PAGINA } from "../../../server/funis-tipos";
import { act, ago, api, navigate, useApi } from "../lib";
import { Button, Empty, ErrorState, Field, Modal, PageHeader, Segmented, Skeleton, cx } from "../ui";

export type AbaFunis = "funis" | TipoSwipe | "vault";
export const ABAS_FUNIS: AbaFunis[] = ["funis", "pagina", "quiz", "dm", "bio", "vault"];

const ORIGEM = { referencia: "Referência", proprio: "Do expert" } as const;
const NOVO: Record<TipoSwipe, string> = { pagina: "Nova página", quiz: "Novo quiz", dm: "Nova DM", bio: "Nova bio" };
const STATUS = { rascunho: "Rascunho", ativo: "Ativo", pausado: "Pausado", arquivado: "Arquivado" } as const;

function irPara(aba: AbaFunis, expert: string) {
  const sp = new URLSearchParams();
  if (aba !== "funis") sp.set("aba", aba);
  if (expert) sp.set("expert", expert);
  const s = sp.toString();
  navigate(`/funis${s ? `?${s}` : ""}`, { replace: true });
}

export function Funis({ aba, expert }: { aba: AbaFunis; expert: string }) {
  const perfis = useApi<Perfil[]>("/api/profiles").data ?? [];
  const funis = useApi<{ funis: FunilApi[] }>("/api/funis?completo=1");
  const swipes = useApi<{ itens: SwipeApi[]; por_tipo: Record<TipoSwipe, number> }>("/api/swipes");
  const vault = useApi<PaginaVault[]>(aba === "vault" ? "/api/vault/paginas" : null);
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<SwipeApi | "novo" | null>(null);
  const [ver, setVer] = useState<SwipeApi | null>(null);
  const nomeExpert = (slug: string | null) => (slug ? perfis.find((p) => p.slug === slug)?.name ?? slug : null);

  const total = funis.data?.funis.length;
  const abas = [
    { value: "funis" as AbaFunis, label: "Funis", n: total },
    ...SWIPES.map((s) => ({ value: s.tipo as AbaFunis, label: s.label, n: swipes.data?.por_tipo[s.tipo] })),
    { value: "vault" as AbaFunis, label: "Páginas do vault", n: vault.data?.length },
  ];
  const secao = SWIPES.find((s) => s.tipo === aba);

  return (
    <div>
      <PageHeader
        title={<>Funis</>}
        meta={<>Funis demonstrativos e swipe de funil · nada aqui integra com Instagram, WhatsApp ou página</>}
        actions={
          aba === "funis" ? <Button variant="accent" icon={<Plus size={16} strokeWidth={2} aria-hidden />} onClick={() => setNovo(true)}>Novo funil</Button>
            : secao ? <Button variant="accent" icon={<Plus size={16} strokeWidth={2} aria-hidden />} onClick={() => setEditar("novo")}>{NOVO[secao.tipo]}</Button>
            : null
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented label="Seção" value={aba} onChange={(a) => irPara(a, expert)} options={abas} className="max-w-full overflow-x-auto" />
        {aba !== "vault" && (
          <select className="field h-[var(--hit)] w-auto min-w-[200px]" value={expert} onChange={(e) => irPara(aba, e.target.value)} aria-label="Filtrar por expert">
            <option value="">Todos os experts e referências</option>
            <option value="-">Só referências gerais (sem expert)</option>
            {perfis.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
        )}
      </div>

      {aba === "funis" && <ListaFunis data={funis.data?.funis} error={funis.error} reload={funis.reload} expert={expert} nomeExpert={nomeExpert} onNovo={() => setNovo(true)} />}
      {secao && <ListaSwipes tipo={secao.tipo} itens={swipes.data?.itens.filter((s) => s.tipo === secao.tipo)} expert={expert} nomeExpert={nomeExpert} onAbrir={(s) => (s.tipo === "pagina" || s.tipo === "quiz" ? setVer(s) : setEditar(s))} onEditar={setEditar} onNovo={() => setEditar("novo")} />}
      {aba === "vault" && <ListaVault data={vault.data} error={vault.error} />}

      {novo && <NovoFunil perfis={perfis} expert={expert} onClose={() => setNovo(false)} />}
      {ver && (
        <PaginaViewer vault={ver.vault} url={ver.url || null} titulo={ver.titulo} onClose={() => setVer(null)}
          acoes={<Button size="sm" variant="ghost" icon={<Pencil size={13} aria-hidden />} onClick={() => { setEditar(ver); setVer(null); }}>Editar ficha</Button>} />
      )}
      {editar && secao && <SwipeModal tipo={secao.tipo} item={editar === "novo" ? null : editar} perfis={perfis} expert={expert} onClose={() => setEditar(null)} />}
    </div>
  );
}

const filtraExpert = <T extends { expert: string | null }>(xs: T[], expert: string) =>
  expert === "-" ? xs.filter((x) => !x.expert) : expert ? xs.filter((x) => x.expert === expert) : xs;

// ---------- funis ----------

function ListaFunis({ data, error, reload, expert, nomeExpert, onNovo }: {
  data?: FunilApi[]; error: string | null; reload: () => void; expert: string; nomeExpert: (s: string | null) => string | null; onNovo: () => void;
}) {
  const [origem, setOrigem] = useState<"todos" | "referencia" | "proprio">("todos");
  if (error && !data) return <ErrorState title="Não foi possível carregar os funis" detail={error} onRetry={reload} />;
  if (!data) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} ratio="16/10" />)}</div>;
  const itens = filtraExpert(data, expert).filter((f) => origem === "todos" || f.origem === origem);
  return (
    <>
      <Segmented size="sm" label="Origem" value={origem} onChange={setOrigem} className="mb-4"
        options={[{ value: "todos", label: "Todos" }, { value: "proprio", label: "Do expert" }, { value: "referencia", label: "Referência" }]} />
      {!itens.length ? (
        <Empty title={data.length ? "Nenhum funil neste filtro" : "Nenhum funil desenhado"} action={<Button variant="accent" onClick={onNovo}>Desenhar um funil</Button>}>
          Desenhe o caminho: post → comentário → DM → link → página → checkout. Cada etapa pode apontar para um vídeo da biblioteca, um item do swipe ou uma página do vault.
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {itens.map((f) => (
            <li key={f.id}>
              <a href={`/funis/${f.id}`} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(`/funis/${f.id}`); }}
                className="funil-card block rounded-r3 border border-line bg-card transition-colors hover:border-ink-3">
                <MiniFunil funil={f} className="aspect-[16/9] w-full rounded-t-r3 bg-sunken" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 text-[15px] font-medium leading-snug">{f.nome}</h2>
                    <span className={cx("funil-status shrink-0", `funil-status--${f.status}`)}>{STATUS[f.status]}</span>
                  </div>
                  <p className="num mt-1 text-[12px] text-ink-3">
                    {ORIGEM[f.origem]}{nomeExpert(f.expert) ? ` · ${nomeExpert(f.expert)}` : ""} · {f.etapas.length} etapas · {ago(f.atualizado_em)}
                  </p>
                  {f.descricao && <p className="mt-2 line-clamp-2 text-[13px] text-ink-2">{f.descricao}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[...new Set(f.etapas.map((e) => e.tipo))].slice(0, 6).map((t) => <EtapaChip key={t} tipo={t} />)}
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NovoFunil({ perfis, expert, onClose }: { perfis: Perfil[]; expert: string; onClose: () => void }) {
  const [v, setV] = useState({ nome: "", origem: expert && expert !== "-" ? "proprio" : "referencia", expert: expert === "-" ? "" : expert, descricao: "" });
  const criar = async () => {
    const f = await act(() => api<FunilApi>("/api/funis", { json: { ...v, expert: v.expert || null } }), "Funil criado");
    if (f) { onClose(); navigate(`/funis/${f.id}`); }
  };
  return (
    <Modal title="Novo funil" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="accent" onClick={criar} disabled={!v.nome.trim()}>Criar e desenhar</Button></>}>
      <form className="flex flex-col gap-4 px-5 pb-5" onSubmit={(e) => { e.preventDefault(); if (v.nome.trim()) criar(); }}>
        <Field label="Nome"><input className="field" autoFocus value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} placeholder="Ex.: Reel receita → comente RECEITA → DM → PV" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origem">
            <select className="field" value={v.origem} onChange={(e) => setV({ ...v, origem: e.target.value })}>
              <option value="proprio">Do expert (atual)</option><option value="referencia">Referência (estudo)</option>
            </select>
          </Field>
          <Field label="Expert">
            <select className="field" value={v.expert} onChange={(e) => setV({ ...v, expert: e.target.value })}>
              <option value="">Nenhum (referência geral)</option>
              {perfis.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Descrição" hint="Opcional: de onde veio, o que testa, o que observar."><textarea className="field" rows={3} value={v.descricao} onChange={(e) => setV({ ...v, descricao: e.target.value })} /></Field>
      </form>
    </Modal>
  );
}

// ---------- swipes ----------

function ListaSwipes({ tipo, itens, expert, nomeExpert, onAbrir, onEditar, onNovo }: {
  tipo: TipoSwipe; itens?: SwipeApi[]; expert: string; nomeExpert: (s: string | null) => string | null; onAbrir: (s: SwipeApi) => void; onEditar: (s: SwipeApi) => void; onNovo: () => void;
}) {
  const [q, setQ] = useState("");
  if (!itens) return <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} ratio="4/5" />)}</div>;
  const n = q.trim().toLowerCase();
  const lista = filtraExpert(itens, expert).filter((s) => !n || [s.titulo, s.autor, s.texto, s.notas, s.tags.join(" ")].join(" ").toLowerCase().includes(n));
  const secao = SWIPES.find((s) => s.tipo === tipo)!;
  const visual = tipo === "pagina" || tipo === "quiz";
  return (
    <>
      <label className="relative mb-4 block max-w-[420px]">
        <Search size={15} strokeWidth={1.5} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
        <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar em ${secao.label.toLowerCase()}…`} />
      </label>
      {!lista.length ? (
        <Empty title={itens.length ? "Nada neste filtro" : `${secao.label}: seção vazia`} action={<Button variant="accent" onClick={onNovo}>Cadastrar</Button>}>
          {tipo === "dm" && "Guarde o roteiro da DM: gatilho (comentário/story), mensagens e para onde leva."}
          {tipo === "bio" && "Guarde bios de referência: o @, o texto completo e o link."}
          {tipo === "pagina" && "Guarde páginas de venda, captura, checkout e upsell com print, link e vínculo com a captura do vault."}
          {tipo === "quiz" && "Guarde quizzes: perguntas, resultado e oferta, com print e vínculo com a captura do vault."}
        </Empty>
      ) : (
        <ul className={cx("grid gap-4", visual ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3")}>
          {lista.map((s) => (
            <li key={s.id} className="relative">
              <button type="button" onClick={() => onAbrir(s)} className="funil-card block h-full w-full rounded-r3 border border-line bg-card text-left transition-colors hover:border-ink-3">
                {visual && (
                  <span className="relative block aspect-[4/5] overflow-hidden rounded-t-r3 bg-media-bg">
                    <PreviaPagina capa={s.capa_url} entrada={s.vault_info?.entrada} className="size-full" />
                    {(s.vault_info?.entrada || s.url || s.vault_info?.imagens) ? <span className="funil-ver"><Eye size={13} aria-hidden />Ver página</span> : null}
                  </span>
                )}
                {tipo === "dm" && <span className="funil-dm m-3 mb-0">{s.texto || "Sem mensagem"}</span>}
                {tipo === "bio" && (
                  <span className="funil-bio m-3 mb-0">
                    <b>{s.autor || s.titulo}</b>
                    <span>{s.texto || "Sem texto"}</span>
                    {s.url && <span className="funil-bio-link">{s.url.replace(/^https?:\/\//, "")}</span>}
                  </span>
                )}
                <span className="block p-3">
                  <span className="block truncate text-[14px] font-medium">{s.titulo}</span>
                  <span className="num block truncate text-[11.5px] text-ink-3">
                    {s.subtipo ? `${s.subtipo} · ` : ""}{ORIGEM[s.origem]}{nomeExpert(s.expert) ? ` · ${nomeExpert(s.expert)}` : ""}{s.autor && tipo !== "bio" ? ` · ${s.autor}` : ""}
                  </span>
                  {!!s.tags.length && <span className="mt-1.5 flex flex-wrap gap-1">{s.tags.slice(0, 4).map((t) => <span key={t} className="funil-tag">{t}</span>)}</span>}
                </span>
              </button>
              {visual && <button type="button" className="funil-editar" onClick={() => onEditar(s)} aria-label={`Editar ${s.titulo}`}><Pencil size={13} aria-hidden /></button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SwipeModal({ tipo, item, perfis, expert, onClose }: { tipo: TipoSwipe; item: SwipeApi | null; perfis: Perfil[]; expert: string; onClose: () => void }) {
  const [v, setV] = useState({
    titulo: item?.titulo ?? "", subtipo: item?.subtipo ?? "vendas", origem: item?.origem ?? (expert && expert !== "-" ? "proprio" : "referencia"),
    expert: item?.expert ?? (expert === "-" ? "" : expert), autor: item?.autor ?? "", url: item?.url ?? "", texto: item?.texto ?? "", notas: item?.notas ?? "",
    tags: item?.tags.join(", ") ?? "", vault: item?.vault ?? null as string | null,
  });
  const [img, setImg] = useState<File | null>(null);
  const [pick, setPick] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const vaultPag = useApi<PaginaVault[]>(v.vault ? "/api/vault/paginas" : null).data?.find((p) => p.rel === v.vault || p.abrir === v.vault);
  const preview = useMemo(() => (img ? URL.createObjectURL(img) : item?.imagem_url ?? vaultUrl(vaultPag?.capa ?? null)), [img, item, vaultPag]);
  const [verPag, setVerPag] = useState(false);
  const textoLabel = { dm: "Mensagens (gatilho → resposta)", bio: "Texto da bio", pagina: "Estrutura / copy da dobra", quiz: "Perguntas, resultado e oferta" }[tipo];

  const salvar = async () => {
    const payload = { ...v, tipo, expert: v.expert || null, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean) };
    const r = await act(() => (item ? api<SwipeApi>(`/api/swipes/${item.id}`, { method: "PATCH", json: payload }) : api<SwipeApi>("/api/swipes", { json: payload })));
    if (!r) return;
    if (img) {
      const fd = new FormData();
      fd.set("file", img);
      await act(() => api(`/api/swipes/${r.id}/imagem`, { body: fd }));
    }
    onClose();
  };
  const [confirma, setConfirma] = useState(false);
  const apagar = async () => {
    if (!item) return;
    if (!confirma) { setConfirma(true); return; }
    await act(() => api(`/api/swipes/${item.id}`, { method: "DELETE" }), "Apagado");
    onClose();
  };

  return (
    <Modal title={item ? item.titulo : NOVO[tipo]} onClose={onClose} width={760}
      footer={<>
        {item && <Button variant="danger" onClick={apagar} className="mr-auto">{confirma ? "Confirmar: apagar de vez" : "Apagar"}</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="accent" onClick={salvar} disabled={!v.titulo.trim()}>Salvar</Button>
      </>}>
      <form className="grid gap-4 px-5 pb-5 sm:grid-cols-[1fr_200px]" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Título"><input className="field" autoFocus value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            {tipo === "pagina" && (
              <Field label="Tipo de página">
                <select className="field" value={v.subtipo} onChange={(e) => setV({ ...v, subtipo: e.target.value })}>{SUBTIPOS_PAGINA.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </Field>
            )}
            <Field label="Origem">
              <select className="field" value={v.origem} onChange={(e) => setV({ ...v, origem: e.target.value as typeof v.origem })}>
                <option value="referencia">Referência</option><option value="proprio">Do expert</option>
              </select>
            </Field>
            <Field label="Expert">
              <select className="field" value={v.expert} onChange={(e) => setV({ ...v, expert: e.target.value })}>
                <option value="">Nenhum</option>{perfis.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tipo === "bio" || tipo === "dm" ? "@ do perfil" : "Dono / marca"}><input className="field" value={v.autor} onChange={(e) => setV({ ...v, autor: e.target.value })} placeholder="@perfil" /></Field>
            <Field label="Link"><input className="field" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://…" /></Field>
          </div>
          <Field label={textoLabel}><textarea className="field" rows={tipo === "bio" ? 4 : 7} value={v.texto} onChange={(e) => setV({ ...v, texto: e.target.value })} /></Field>
          <Field label="Notas" hint="Por que funciona, o que modelar, o que evitar."><textarea className="field" rows={3} value={v.notas} onChange={(e) => setV({ ...v, notas: e.target.value })} /></Field>
          <Field label="Tags" hint="Separadas por vírgula."><input className="field" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} placeholder="jejum, quiz longo, vsl" /></Field>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-medium">Print</span>
          <button type="button" onClick={() => file.current?.click()} className="aspect-[4/5] overflow-hidden rounded-r2 border border-dashed border-line-2 bg-sunken text-[12px] text-ink-3 hover:border-ink-3">
            {preview ? <img src={preview} alt="" className="size-full object-cover object-top" /> : <span className="inline-flex flex-col items-center gap-1"><ImageUp size={18} strokeWidth={1.5} aria-hidden />Enviar imagem</span>}
          </button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => setImg(e.target.files?.[0] ?? null)} />
          <span className="text-[13px] font-medium">Página no vault</span>
          {v.vault ? (
            <div className="rounded-r2 border border-line p-2 text-[12px]">
              <p className="line-clamp-3 break-all">{vaultPag?.nome ?? v.vault}</p>
              <div className="mt-2 flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setVerPag(true)}>Ver página</Button>
                <Button size="sm" variant="ghost" onClick={() => setV({ ...v, vault: null })}>Tirar</Button>
              </div>
            </div>
          ) : <Button size="sm" variant="secondary" onClick={() => setPick(true)}>Vincular captura</Button>}
        </div>
      </form>
      {pick && <PickVault onClose={() => setPick(false)} onPick={(rel) => { setV({ ...v, vault: rel }); setPick(false); }} />}
      {verPag && v.vault && <PaginaViewer vault={v.vault} url={v.url || null} titulo={v.titulo || vaultPag?.nome} onClose={() => setVerPag(false)} />}
    </Modal>
  );
}

// ---------- páginas do vault ----------

const TIPO_VAULT: Record<PaginaVault["tipo"], string> = { pagina: "Página", quiz: "Quiz", checkout: "Checkout", upsell: "Upsell/downsell", advertorial: "Advertorial", outro: "Outro" };

function ListaVault({ data, error }: { data: PaginaVault[] | null; error: string | null }) {
  const [ver, setVer] = useState<PaginaVault | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<"todos" | PaginaVault["tipo"]>("todos");
  if (error && !data) return <ErrorState title="Não foi possível ler as páginas do vault" detail={error} />;
  if (!data) return <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} ratio="4/5" />)}</div>;
  const n = q.trim().toLowerCase();
  const lista = data.filter((p) => (tipo === "todos" || p.tipo === tipo) && (!n || `${p.nome} ${p.grupo}`.toLowerCase().includes(n)));
  const tipos = [...new Set(data.map((p) => p.tipo))];
  const salvar = (p: PaginaVault) => act(
    () => api("/api/swipes", { json: { tipo: p.tipo === "quiz" ? "quiz" : "pagina", subtipo: p.tipo === "checkout" ? "checkout" : p.tipo === "upsell" ? "upsell" : p.tipo === "advertorial" ? "advertorial" : "vendas", titulo: p.nome, vault: p.rel } }),
    `"${p.nome}" foi para o swipe (${p.tipo === "quiz" ? "Quiz" : "Páginas"})`,
  );
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="field max-w-[360px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar página capturada…" />
        <Segmented size="sm" label="Tipo" value={tipo} onChange={setTipo} options={[{ value: "todos", label: "Todos", n: data.length }, ...tipos.map((t) => ({ value: t, label: TIPO_VAULT[t], n: data.filter((p) => p.tipo === t).length }))]} />
      </div>
      <p className="mb-4 text-[12.5px] text-ink-3">Lido direto do vault, sem copiar: <code>05_Biblioteca/04_Paginas/01_paginas</code> (catálogo), <code>05_Biblioteca/04_Paginas/02_trabalhos</code> e <code>05_Biblioteca/_swipe/07 Funis e Paginas Capturadas</code>.</p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {lista.map((p) => (
          <li key={p.rel} className="funil-card flex flex-col rounded-r3 border border-line bg-card">
            <button type="button" onClick={() => setVer(p)} className="relative block aspect-[4/5] overflow-hidden rounded-t-r3 bg-media-bg" aria-label={`Ver ${p.nome}`}>
              <PreviaPagina capa={vaultUrl(p.capa)} entrada={p.capa ? null : vaultUrl(p.entrada)} className="size-full" />
              <span className="funil-ver"><Eye size={13} aria-hidden />{p.entrada ? "Ver página" : "Ver capturas"}</span>
            </button>
            <div className="flex flex-1 flex-col p-3">
              <span className="line-clamp-2 text-[13px] font-medium leading-snug">{p.nome}</span>
              <span className="num mt-0.5 truncate text-[11px] text-ink-3">{TIPO_VAULT[p.tipo]}{p.arquivos.length > 1 ? ` · ${p.arquivos.length} arquivos` : ""} · {p.grupo}</span>
              <div className="mt-auto flex flex-wrap gap-1 pt-2.5">
                <Button size="sm" variant="secondary" icon={<Eye size={13} strokeWidth={1.75} aria-hidden />} onClick={() => setVer(p)}>Ver</Button>
                <Button size="sm" variant="ghost" icon={<FolderOpen size={13} strokeWidth={1.75} aria-hidden />} onClick={() => act(() => api("/api/vault/abrir", { json: { p: p.rel, finder: true } }))} aria-label="Mostrar no Finder" />
                <Button size="sm" variant="ghost" icon={<Workflow size={13} strokeWidth={1.75} aria-hidden />} onClick={() => salvar(p)}>Swipe</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {ver && <PaginaViewer vault={ver.rel} titulo={ver.nome} onClose={() => setVer(null)}
        acoes={<Button size="sm" variant="ghost" icon={<Workflow size={13} aria-hidden />} onClick={() => salvar(ver)}>Mandar pro swipe</Button>} />}
    </>
  );
}
