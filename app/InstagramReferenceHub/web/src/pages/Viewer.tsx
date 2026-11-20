import {
  ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FolderOpen, Link2, Maximize2, Minimize2, Plus, RefreshCw, Star, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FacetsResponse, Kind, PipelineItem, PipelineResponse, RefDetail, RefPipeline } from "../../../server/types";
import { ANALYSIS_FIELDS, ORIGEM_LABEL } from "../../../server/types";
import { extractCtaActions } from "../../../server/text";
import { InstagramPost, type PostData, type PostSlide } from "../components/InstagramPost";
import { LifecycleBar } from "../components/LifecycleBar";
import { StageBadge } from "../components/StageBadge";
import {
  act, api, apiUrl, closeRef, copy, fmtBytes, fmtDate, fmtDateTime, fmtDuration, fmtInt, isTyping, media, navigate, openRef,
  resultIds, stageRank, toast, useApi, useStore,
} from "../lib";
import { AtribuirExpert, initials, mediaRatio, pipeSub, refShort, toggleFavorite } from "../refs";
import { NovaReplicacao } from "../replication";
import { Button, CheckList, CollectedAt, cx, IconButton, MetricValue, Modal, Popover, Segmented } from "../ui";

const KIND_LABEL: Record<Kind, string> = { video: "Reel", carrossel: "Carrossel", imagem: "Foto" };

/**
 * Viewer (SPEC §5.2): painel lateral de 420 px sobre a grade (tela cheia no mobile).
 * Post real (Original | Recriação) → Produção desta referência → Classificação → Legenda/CTA → seções recolhidas.
 * Atalhos: Esc fecha · ←/→ anterior/próxima · Enter expande · F favorita · espaço/K reproduz · , . quadro · M marcador.
 */
export function Viewer({ id }: { id: string }) {
  const { data: r, error, reload } = useApi<RefDetail>(apiUrl.ref(id));
  const ids = useStore(resultIds);
  const idx = ids.indexOf(id);
  const prev = idx > 0 ? ids[idx - 1] : null;
  const next = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;
  const [largo, setLargo] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [marcador, setMarcador] = useState<number | null>(null);

  const video = () => document.querySelector<HTMLVideoElement>("[data-viewer] .ig video");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".modal, .pop")) return;
      const t = e.target as HTMLElement;
      if (e.key === "Escape") { e.preventDefault(); closeRef(); return; }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !t.closest?.(".ig-track, [role=slider]")) {
        const to = e.key === "ArrowLeft" ? prev : next;
        if (to) { e.preventDefault(); openRef(to); }
        return;
      }
      if (e.key === "Enter" && !t.closest?.("button, a, summary, video")) { e.preventDefault(); setLargo((v) => !v); return; }
      const k = e.key.toLowerCase();
      if (k === "f" && r) { e.preventDefault(); toggleFavorite(r); return; }
      const v = video();
      if (!v) return;
      if (e.key === " " || k === "k") { e.preventDefault(); v.paused ? v.play() : v.pause(); }
      else if (e.key === ",") { v.pause(); v.currentTime = Math.max(0, v.currentTime - 1 / 30); }
      else if (e.key === ".") { v.pause(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 1 / 30); }
      else if (k === "m") { e.preventDefault(); v.pause(); setMarcador(v.currentTime); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, r]);

  // No mobile o viewer é tela cheia: trava a rolagem do fundo. No desktop a grade continua visível.
  useEffect(() => {
    if (!matchMedia("(max-width: 767px)").matches) return;
    const o = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = o; };
  }, []);

  const save = useCallback(async (patch: Record<string, unknown>, ok?: string, undo?: Record<string, unknown>) => {
    await act(() => api(apiUrl.ref(id), { method: "PATCH", json: patch }), ok, undo ? () => api(apiUrl.ref(id), { method: "PATCH", json: undo }) : undefined);
  }, [id]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal data-viewer aria-label={`Referência ${id}`}>
      <div className="fade-in absolute inset-0 max-md:hidden" style={{ background: "color-mix(in srgb, var(--ink) 12%, transparent)" }} onClick={closeRef} aria-hidden />
      <aside
        className={cx(
          "fade-in absolute inset-y-0 right-0 flex w-full flex-col bg-paper md:border-l md:border-line md:shadow-[var(--sh-2)]",
          largo ? "md:w-[min(1120px,calc(100vw-32px))]" : "md:w-[440px]",
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-card px-3 sm:px-4">
          <span className="num min-w-0 flex-1 truncate text-[12px] text-ink-2" title={id}>
            {refShort(id)}{r && <span className="text-ink-3"> · {KIND_LABEL[r.kind]}{idx >= 0 ? ` · ${idx + 1} de ${ids.length}` : ""}</span>}
          </span>
          <IconButton label="Referência anterior" kbd="←" disabled={!prev} onClick={() => prev && openRef(prev)}><ChevronLeft size={18} strokeWidth={1.75} /></IconButton>
          <IconButton label="Próxima referência" kbd="→" disabled={!next} onClick={() => next && openRef(next)}><ChevronRight size={18} strokeWidth={1.75} /></IconButton>
          <IconButton label={largo ? "Recolher painel" : "Expandir painel"} kbd="↵" className="max-md:hidden" onClick={() => setLargo((v) => !v)}>
            {largo ? <Minimize2 size={16} strokeWidth={1.75} /> : <Maximize2 size={16} strokeWidth={1.75} />}
          </IconButton>
          <IconButton label="Fechar" kbd="Esc" onClick={closeRef}><X size={18} strokeWidth={1.75} /></IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!r && !error && <div className="p-4"><div className="esq" style={{ aspectRatio: "9/16", maxWidth: 340, margin: "0 auto" }} /></div>}
          {error && (
            <div className="p-4">
              <div className="estado estado--erro" role="alert"><div className="corpo"><b>Não deu para abrir {refShort(id)}</b><p className="mono">{error}</p></div>
                <div className="acoes"><Button size="sm" onClick={reload}>Tentar de novo</Button></div></div>
            </div>
          )}
          {r && (
            <div className={cx(largo && "md:grid md:grid-cols-[minmax(0,1fr)_420px] md:items-start md:gap-0")}>
              <div className={cx("p-4", largo && "md:sticky md:top-0")}>
                <Post r={r} largo={largo} />
              </div>
              <div className={cx(largo && "md:border-l md:border-line")}>
                <Producao r={r} />
                {r.kind === 'carrossel' && <PacoteChat key={r.id} r={r} />}
                <Classificacao r={r} save={save} reload={reload} />
                <LegendaCta r={r} />
                <Recolhidas r={r} save={save} reload={reload} marcador={marcador} setMarcador={setMarcador} onDelete={() => setConfirmDelete(true)} />
              </div>
            </div>
          )}
        </div>
      </aside>

      {confirmDelete && r && (
        <Modal title={<>Excluir <em>referência</em>?</>} onClose={() => setConfirmDelete(false)} footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
          <Button variant="danger" icon={<Trash2 size={16} strokeWidth={1.5} />} onClick={async () => {
            const ok = await act(() => api(apiUrl.ref(r.id), { method: "DELETE" }), `${refShort(r.id)} excluída`);
            if (ok) { setConfirmDelete(false); closeRef(); }
          }}>Excluir de vez</Button>
        </>}>
          <p className="text-[14px] text-ink-2">
            <span className="num text-ink">{r.id}</span> sai da biblioteca e os arquivos (vídeo, capa e tira de quadros) são apagados do disco. Experts e quadros não são afetados. Faça um backup antes se tiver dúvida.
          </p>
        </Modal>
      )}
    </div>
  );
}

// ---------- post (Original | Recriação) ----------

function slidesDaRef(r: RefDetail): PostSlide[] | undefined {
  if (r.kind !== "carrossel") return undefined;
  return (r.media ?? []).map((m) => ({
    n: m.position + 1, src: m.path ? media(m.path) ?? null : m.thumb ? media(m.thumb) ?? null : null,
    estado: m.path || m.thumb ? "pronto" : "pendente", w: m.width, h: m.height,
  }));
}

/** Post completo de uma referência (mídia, legenda, @): o mesmo objeto do visualizador, reaproveitado nas etapas do funil. */
export function postDaRef(r: RefDetail): PostData {
  const formato: PostData["formato"] = r.kind === "video" ? "reel" : r.kind === "carrossel" ? "carrossel" : "imagem";
  return {
    id: r.id,
    chave: { ref: refShort(r.id) },
    perfil: { handle: r.username, nome: r.username ? undefined : "sem @" },
    formato,
    proporcao: mediaRatio(r),
    midia_video: r.video_path ? { src: media(r.video_path), poster: media(r.thumb_path), duracao_s: r.duration, w: r.width, h: r.height } : null,
    capa: media(r.thumb_path) ?? null,
    slides: slidesDaRef(r),
    total_previsto: r.kind === "carrossel" ? r.media_count : undefined,
    legenda: r.caption,
    contexto: r.display_name ?? (r.creator_guess ? `@${r.creator_guess}? sugerido` : null),
    contain: r.kind === "imagem",
  };
}

function Post({ r, largo }: { r: RefDetail; largo: boolean }) {
  const pipe = useApi<PipelineResponse>(r.pipeline?.length ? apiUrl.pipeline() : null).data;
  const recs = useMemo(() => (pipe?.itens ?? []).filter((i) => i.ref === r.id && i.editado_url)
    .sort((a, b) => stageRank(b.stage) - stageRank(a.stage)), [pipe, r.id]);
  const [recId, setRecId] = useState<string | null>(null);
  const [ver, setVer] = useState<"ori" | "rec">("ori");
  const rec: PipelineItem | undefined = recs.find((x) => x.id === recId) ?? recs[0];

  const doc = postDaRef(r);
  const recPost: PostData | null = rec ? {
    id: rec.id,
    chave: { ref: refShort(r.id) },
    perfil: { nome: rec.client_name },
    formato: "reel",
    proporcao: "9/16",
    midia_video: { src: rec.editado_url },
    capa: rec.capa_url,
    legenda: null,
    contexto: `recriação · ${refShort(r.id)}`,
    status: rec.stage,
    sub: rec.stage === "postada" ? undefined : rec.sub || undefined,
  } : null;
  const post = recPost && ver === "rec" ? recPost : doc;

  const footNote = r.width && r.height ? `${r.width}×${r.height}` : undefined;
  return (
    <div className={cx("mx-auto", r.kind === "video" ? (largo ? "max-w-[420px]" : "max-w-[300px]") : largo ? "max-w-[560px]" : undefined)}>
      {recPost && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Segmented label="Mostrar" size="sm" value={ver} onChange={setVer} options={[{ value: "ori", label: "Original" }, { value: "rec", label: "Recriação" }]} />
          {ver === "rec" && recs.length > 1 && recs.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === rec?.id} onClick={() => setRecId(x.id)}
              className={cx("chip chip--static !cursor-pointer", x.id === rec?.id && "!bg-ink !text-on-ink")}>{x.client_name}</button>
          ))}
          {ver === "rec" && recs.length === 1 && <span className="num text-[11px] text-ink-3">{rec!.client_name}</span>}
        </div>
      )}
      <InstagramPost
        key={`${r.id}-${ver}-${rec?.id ?? "ref"}`}
        post={post}
        footNote={ver === "ori" ? footNote : undefined}
        actions={<><IconButton label={r.favorite ? "Remover das favoritas" : "Favoritar"} kbd="F" size="sm" active={r.favorite} onClick={() => toggleFavorite(r)}>
          <Star size={16} strokeWidth={1.5} className={r.favorite ? "fill-brasa text-brasa" : ""} />
        </IconButton><Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} disabledReason={r.file_exists ? undefined : "Arquivo não está no disco"}
          onClick={() => act(() => api(`/api/refs/${r.id}/reveal`, { method: "POST" }))}>Pasta</Button></>}
      />
    </div>
  );
}

// ---------- seções ----------

function Secao({ titulo, aside, children, id }: { titulo: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="border-t border-line px-4 py-4 sm:px-5" aria-labelledby={id}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={id} className="num text-[10px] tracking-[.12em] text-ink-3 uppercase">{titulo}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Producao({ r }: { r: RefDetail }) {
  const experts = useApi<{ id: number; name: string; ativo?: boolean; avatar?: string | null }[]>("/api/clients").data;
  const [nova, setNova] = useState<string | null>(null);
  const pipes = [...(r.pipeline ?? [])].sort((a, b) => stageRank(b.stage) - stageRank(a.stage));
  const atribuidos = (r.clients ?? []).filter((c) => !pipes.some((p) => p.client.id === c.id));
  const livres = (experts ?? []).filter((e) => e.ativo !== false && !pipes.some((p) => p.client.id === e.id));
  const top = pipes[0];

  return (
    <Secao titulo="Produção desta referência" id="sec-producao">
      <LifecycleBar stage={r.stage} sub={top && top.stage !== "postada" ? pipeSub(top) : undefined} />
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {pipes.map((p) => <LinhaProducao key={p.id} p={p} />)}
        {atribuidos.map((c) => (
          <li key={`c${c.id}`} className="flex items-center gap-3 py-2.5">
            <Iniciais nome={c.name} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{c.name}</div>
              <StageBadge stage="atribuida" sub="sem replicação" />
            </div>
            {r.kind === "video" && <Button size="sm" variant="secondary" onClick={() => setNova(String(c.id))}>Replicar</Button>}
          </li>
        ))}
        {!pipes.length && !atribuidos.length && (
          <li className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 text-[13px] text-ink-2">Sem destino: nenhum expert ainda.</span>
            <AtribuirExpert r={r} />
          </li>
        )}
      </ul>
      {r.kind === "video" && (
        <Popover width={260} trigger={({ toggle, open }) => (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} aria-expanded={open} onClick={toggle} className="mt-2 -ml-2">Replicar para outro expert</Button>
        )}>
          {(close) => !experts ? <p className="pop-empty">Carregando…</p> : livres.length ? (
            <ul className="pop-list" role="menu">
              {livres.map((e) => (
                <li key={e.id} role="none">
                  <button type="button" role="menuitem" className="pop-opt" onClick={() => { close(); setNova(String(e.id)); }}>
                    <span className="lb">{e.name}</span>{!e.avatar && <span className="n">sem contact sheet</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="pop-empty">Todos os experts já têm replicação desta referência.</p>}
        </Popover>
      )}
      {nova && <NovaReplicacao stayOnPage refInicial={r.id} expertInicial={nova} onClose={() => setNova(null)} />}
    </Secao>
  );
}

function PacoteChat({r}:{r:RefDetail}){
  const experts=useApi<{id:number;name:string;slug:string;ativo?:boolean}[]>('/api/clients').data?.filter(e=>e.ativo!==false);
  const {data:packages,reload}=useApi<{id:string;expert:string;status:string;createdAt:string;download:string}[]>('/api/refs/'+r.id+'/pacotes-chat');
  const [expert,setExpert]=useState(''),[changes,setChanges]=useState(''),[signature,setSignature]=useState(''),[useIdentity,setUseIdentity]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Secao titulo="Preparar para outro chat" id="sec-pacote-chat">
    <p className="mb-3 text-[13px] text-ink-2">Originais, legenda, identidade e prompt no mesmo pacote. Use no ChatGPT ou Claude. As novas imagens serão geradas lá.</p>
    <div className="space-y-3">
      <label className="block text-[12px] text-ink-2">Personagem
        <select className="field mt-1 block w-full" value={expert} onChange={e=>setExpert(e.target.value)}>
          <option value="">Escolha o personagem</option>{experts?.map(e=><option key={e.id} value={e.slug}>{e.name}</option>)}
        </select>
      </label>
      <label className="flex gap-2 text-[12px] text-ink-2"><input type="checkbox" checked={useIdentity} onChange={e=>setUseIdentity(e.target.checked)} />Usar a identidade do expert para substituir um personagem</label>
      <label className="block text-[12px] text-ink-2">Alterações solicitadas
        <textarea className="field mt-1 block min-h-20 w-full" value={changes} onChange={e=>setChanges(e.target.value)} placeholder="Ex.: trocar o menino da abertura por uma menina loira" />
      </label>
      <label className="block text-[12px] text-ink-2">Assinatura de destino
        <input className="field mt-1 block w-full" value={signature} onChange={e=>setSignature(e.target.value)} placeholder="@perfil, se houver substituição" />
      </label>
      {error&&<p role="alert" className="text-[13px] text-ink-2">{error}</p>}
      <Button size="sm" disabled={!expert||busy} onClick={async()=>{
        setBusy(true);setError('');
        try{await api('/api/refs/'+r.id+'/pacote-chat',{method:'POST',body:JSON.stringify({expert,identityMode:useIdentity?'expert':'none',alteracoes:changes,assinatura:signature})});reload();toast('Pacote preparado; nenhuma imagem gerada');}
        catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>{busy?'Preparando arquivos…':'Preparar pacote para chat'}</Button>
      {!!packages?.length&&<ul className="divide-y divide-line">{packages.map(p=><li key={p.id} className="py-2 text-[12px]">
        <a className="underline underline-offset-4" href={p.download} download>Baixar pacote · {experts?.find(e=>e.slug===p.expert)?.name??p.expert}</a>
        <span className="mt-1 block text-ink-3">{fmtDateTime(p.createdAt)} · fontes e prompt preparados</span>
      </li>)}</ul>}
    </div>
  </Secao>;
}

function LinhaProducao({ p }: { p: RefPipeline }) {
  const posted = p.stage === "postada" && p.postUrl;
  const studio = `/replicacao/${p.id}`;
  return (
    <li className="flex items-center gap-3 py-2.5" data-pipeline={p.id}>
      <Iniciais nome={p.client.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{p.client.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <StageBadge stage={p.stage} sub={posted ? `${p.postadoEm ? fmtDate(p.postadoEm).slice(0, 5) : p.sub} · ver ↗` : pipeSub(p)} late={p.late || undefined}
            href={posted ? p.postUrl! : undefined} title={posted ? "Abrir o post no Instagram" : undefined} />
          {p.posts && p.posts.total > 0 && <span className="num text-[11px] text-ink-2" title="Posts desta replicação na Postagens.md (cada variação é um post)">{p.posts.postados}/{p.posts.total - p.posts.arquivados} no ar</span>}
          {p.clipsTotal > 0 && ["pronta", "agendada", "postada"].includes(p.stage) && <span className="num text-[11px] text-ink-3">{p.clips}/{p.clipsTotal} clipes</span>}
        </div>
      </div>
      <a href={studio} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); closeAndGo(studio); }} className="btn btn--secondary btn--sm" aria-label={`Estúdio de ${p.client.name}`}>Estúdio</a>
    </li>
  );
}

/** Sai do overlay do viewer e navega (o estúdio é uma página, não um overlay). */
function closeAndGo(to: string) {
  navigate(to);
}

function Iniciais({ nome }: { nome: string }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2" aria-hidden>{initials(nome)}</span>;
}

// ---------- classificação (.tagv editáveis) ----------

type Axis = FacetsResponse["facets"][number];

function Classificacao({ r, save, reload }: { r: RefDetail; save: (p: Record<string, unknown>, ok?: string, undo?: Record<string, unknown>) => Promise<void>; reload: () => void }) {
  const facets = useApi<FacetsResponse>(apiUrl.facets(true)).data;
  const cols = (useApi<any[]>("/api/collections").data ?? []).filter((c) => c.kind === "manual" && !String(c.name).startsWith("@"));
  const axis = (k: string) => facets?.facets.find((f) => f.key === k);
  const quadros = r.collections.filter((c) => !c.name.startsWith("@"));
  const colIds = r.collections.map((c) => c.id);

  return (
    <Secao titulo="Classificação" id="sec-class">
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 text-[13px]">
        <dt className="pt-0.5 text-ink-3">Tipo</dt>
        <dd className="pt-0.5">{KIND_LABEL[r.kind]}{r.kind === "carrossel" ? ` · ${r.media_count} slides` : r.duration != null ? ` · ${fmtDuration(r.duration)}` : ""}</dd>
        {(["formato", "estilo", "objetivo", "angulo", "gancho", "nicho"] as const).map((k) => {
          const a = axis(k);
          return <EditorFaceta key={k} r={r} k={k} axis={a} label={a?.label ?? k} save={save} />;
        })}
        <AnguloPorParte r={r} reload={reload} />
        <dt className="pt-0.5 text-ink-3">Criador</dt>
        <dd><Criador r={r} save={save} /></dd>
        <dt className="pt-0.5 text-ink-3">Experts</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {r.clients.map((c) => <span key={c.id} className="tagv">{c.name}</span>)}
          <AtribuirExpert r={r} label={r.clients.length ? "Editar" : "Atribuir"} />
        </dd>
        <dt className="pt-0.5 text-ink-3">Quadros</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {quadros.map((c) => (
            <span key={c.id} className="tagv">{c.name}
              <button type="button" aria-label={`Tirar do quadro ${c.name}`} className="-mr-1 grid size-5 place-items-center rounded-r1 text-ink-3 hover:text-ink"
                onClick={() => act(() => api(`/api/collections/${c.id}/refs`, { json: { refs: [r.id], remove: true } }), `Saiu de “${c.name}”`,
                  () => api(`/api/collections/${c.id}/refs`, { json: { refs: [r.id] } }))}><X size={12} /></button>
            </span>
          ))}
          <Popover width={280} trigger={({ toggle, open }) => <IconButton label="Adicionar a um quadro" size="sm" aria-expanded={open} onClick={toggle}><Plus size={14} /></IconButton>}>
            {() => (
              <CheckList options={cols.map((c) => ({ value: c.id, label: c.name }))} value={colIds} empty="Crie um quadro na aba Quadros."
                onChange={async (v) => {
                  const added = v.filter((x) => !colIds.includes(x));
                  const removed = colIds.filter((x) => !v.includes(x));
                  await act(async () => {
                    for (const c of added) await api(`/api/collections/${c}/refs`, { json: { refs: [r.id] } });
                    for (const c of removed) await api(`/api/collections/${c}/refs`, { json: { refs: [r.id], remove: true } });
                  }, added.length ? "Adicionada ao quadro" : "Removida do quadro");
                }} />
            )}
          </Popover>
        </dd>
        <dt className="text-ink-3">Origem</dt>
        <dd className="text-ink-2">{ORIGEM_LABEL[r.origem] ?? r.origem}{r.legacy_id && <span className="num text-[11px] text-ink-3"> · {r.legacy_id}</span>}</dd>
      </dl>
    </Secao>
  );
}

/** Ângulo do hook × ângulos do corpo (análise automática da importação). A faceta acima guarda a união. */
function AnguloPorParte({ r, reload }: { r: RefDetail; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const a = r.angulo_analise;
  if (r.kind !== "video") return null;
  const refazer = async () => { setBusy(true); await act(() => api(`/api/refs/${r.id}/angulos`, { method: "POST" }), "Ângulos reanalisados"); setBusy(false); reload(); };
  const lista = (v?: string[]) => (v?.length ? v.join(" · ") : "—");
  return (
    <>
      <dt className="pt-0.5 text-ink-3">Por parte</dt>
      <dd className="min-w-0 space-y-1 text-ink-2">
        {!a && <p className="italic text-ink-3">Análise de ângulo na fila.</p>}
        {a?.status === "erro" && <p className="text-warn">Análise falhou: {a.erro}</p>}
        {a?.status === "ok" && <>
          <p><span className="text-ink-3">Hook:</span> {lista(a.hook?.angulos)}{a.hook?.texto && <span className="text-ink-3"> — “{a.hook.texto}”</span>}</p>
          <p><span className="text-ink-3">Corpo:</span> {lista(a.corpo?.angulos)}</p>
          {a.justificativa && <p className="text-[12px] text-ink-3">{a.justificativa}</p>}
          {a.revisao && <p className="text-[12px] text-ink-3">Revisão: {a.revisao.resultado === "corrigida" ? "corrigida" : "confirmada"} · {a.revisao.motivo}</p>}
        </>}
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} busy={busy} busyLabel="Analisando…" onClick={refazer}>{a ? "Reanalisar" : "Analisar agora"}</Button>
      </dd>
    </>
  );
}

function EditorFaceta({ r, k, axis, label, save }: { r: RefDetail; k: string; axis: Axis | undefined; label: string; save: (p: Record<string, unknown>, ok?: string, undo?: Record<string, unknown>) => Promise<void> }) {
  const atual = r.facets?.[k] ?? [];
  const ids = atual.map((v) => v.id);
  const one = axis?.cardinality !== "many";
  const set = (next: number[], ok: string) => save({ facets: { [k]: next } }, ok, { facets: { [k]: ids } });
  const sugeridos = atual.filter((v) => v.source === "auto");
  if (!axis && !atual.length) return null;
  return (
    <>
      <dt className="pt-0.5 text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
        {atual.map((v) => (
          <span key={v.id} className={cx("tagv", v.source === "auto" && "tagv--sug")}>
            {v.name}{v.source === "auto" && <span className="q">?</span>}
            <button type="button" aria-label={`Tirar ${v.name}`} className="-mr-1 grid size-5 place-items-center rounded-r1 text-ink-3 hover:text-ink" onClick={() => set(ids.filter((x) => x !== v.id), `${label} removido`)}><X size={12} /></button>
          </span>
        ))}
        {sugeridos.length > 0 && <Button size="sm" variant="secondary" icon={<Check size={14} />} onClick={() => set(ids, `${label} confirmado`)}>Confirmar</Button>}
        {axis && (
          <Popover width={280} trigger={({ toggle, open }) => (
            atual.length
              ? <IconButton label={`Trocar ${label.toLowerCase()}`} size="sm" aria-expanded={open} onClick={toggle}><ChevronDown size={14} /></IconButton>
              : <button type="button" aria-expanded={open} onClick={toggle} className="tagv !bg-transparent border border-dashed border-line-2 !text-ink-3 hover:!text-ink hover:border-ink-3">+ definir</button>
          )}>
            {(close) => (
              <div>
                <ul className="pop-list" role="listbox" aria-label={label} aria-multiselectable={!one}>
                  {axis.values.map((v) => {
                    const on = ids.includes(v.id);
                    return (
                      <li key={v.id}>
                        <button type="button" role="option" aria-selected={on} className="pop-opt" onClick={() => {
                          const next = one ? (on ? [] : [v.id]) : on ? ids.filter((x) => x !== v.id) : [...ids, v.id];
                          set(next, on ? `${label} removido` : `${label}: ${v.name}`);
                          if (one) close();
                        }}>
                          <span className="bx" aria-hidden>{on && <Check strokeWidth={2.5} />}</span>
                          <span className="lb">{v.name}</span><span className="n">{fmtInt(v.n)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <NovoValor k={k} label={label} onCreated={(nid, name) => { set(one ? [nid] : [...ids, nid], `${label}: ${name}`); close(); }} />
              </div>
            )}
          </Popover>
        )}
      </dd>
    </>
  );
}

function NovoValor({ k, label, onCreated }: { k: string; label: string; onCreated: (id: number, name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form className="mt-1 flex gap-1 border-t border-line pt-2" onSubmit={async (e) => {
      e.preventDefault();
      const name = v.trim();
      if (!name) return;
      const c = await act(() => api<{ id: number; name: string }>(`/api/facets/${k}/values`, { json: { name } }));
      if (c) { setV(""); onCreated(c.id, c.name ?? name); }
    }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`Novo valor de ${label.toLowerCase()}`} aria-label={`Novo valor de ${label}`} className="field h-9 min-w-0 flex-1 text-[13px]" />
      <Button type="submit" size="sm" variant="secondary">Criar</Button>
    </form>
  );
}

function Criador({ r, save }: { r: RefDetail; save: (p: Record<string, unknown>, ok?: string, undo?: Record<string, unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(r.creator_guess ?? "");
  useEffect(() => setV(r.creator_guess ?? ""), [r.creator_guess]);
  if (r.username) return <span className="tagv">@{r.username}</span>;
  if (edit) {
    return (
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const g = v.trim().replace(/^@/, ""); save({ creator_guess: g || null }, g ? `@${g}? sugerido` : "Sugestão removida", { creator_guess: r.creator_guess }); setEdit(false); }}>
        <input autoFocus className="field h-8 min-w-0 flex-1 text-[13px]" value={v} onChange={(e) => setV(e.target.value)} placeholder="@criador" aria-label="@ sugerido do criador"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEdit(false); } }} />
        <Button type="submit" size="sm" variant="secondary">Salvar</Button>
      </form>
    );
  }
  if (r.creator_guess) {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="tagv tagv--sug" onClick={() => setEdit(true)} title="Editar sugestão">@{r.creator_guess} <span className="q">?</span></button>
          <Button size="sm" variant="secondary" icon={<Check size={14} />}
            onClick={() => save({ username: r.creator_guess, creator_guess: null }, `Criador confirmado: @${r.creator_guess}`)}>Confirmar</Button>
        </span>
        <span className="num text-[11px] text-ink-3">sugerido · sem @ no Instagram</span>
      </div>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="italic text-ink-3">sem @</span>
      <button type="button" className="tagv !bg-transparent border border-dashed border-line-2 !text-ink-3 hover:!text-ink hover:border-ink-3" onClick={() => setEdit(true)}>+ sugerir</button>
    </span>
  );
}

// ---------- legenda e CTA ----------

function LegendaCta({ r }: { r: RefDetail }) {
  const ctas = extractCtaActions(r.caption);
  return (
    <Secao titulo="Legenda e CTA" id="sec-cta" aside={r.url && <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => copy(r.url!, "Link copiado")}>Copiar link</Button>}>
      {r.caption ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[13px] leading-[1.55] text-ink-2 [&::-webkit-details-marker]:hidden">
            <span className="line-clamp-3 group-open:line-clamp-none whitespace-pre-wrap break-words">{r.caption}</span>
            <span className="mt-1 inline-block text-[12px] text-ink-3 underline-offset-4 group-open:hidden hover:underline">legenda inteira</span>
          </summary>
        </details>
      ) : <p className="text-[13px] text-ink-3">Legenda não disponível.</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ctas.length ? ctas.map((a, i) => (
          <span key={`${a.kind}-${i}`} className="tagv">{a.label}{a.detail && <b className="num font-medium">“{a.detail}”</b>}</span>
        )) : <span className="text-[13px] text-ink-3">Nenhuma CTA escrita na legenda.</span>}
      </div>
    </Secao>
  );
}

// ---------- seções recolhidas ----------

function Recolhivel({ titulo, aberto, children, n }: { titulo: string; aberto?: boolean; children: ReactNode; n?: ReactNode }) {
  return (
    <details open={aberto || undefined} className="group border-t border-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-medium sm:px-5 [&::-webkit-details-marker]:hidden hover:bg-sunken">
        <ChevronRight size={14} className="text-ink-3 transition-transform group-open:rotate-90" aria-hidden />
        <span className="flex-1">{titulo}</span>
        {n != null && <span className="num text-[11px] font-normal text-ink-3">{n}</span>}
      </summary>
      <div className="px-4 pt-1 pb-5 sm:px-5">{children}</div>
    </details>
  );
}

function Recolhidas({ r, save, reload, marcador, setMarcador, onDelete }: {
  r: RefDetail; save: (p: Record<string, unknown>, ok?: string) => Promise<void>; reload: () => void;
  marcador: number | null; setMarcador: (t: number | null) => void; onDelete: () => void;
}) {
  const analises = ANALYSIS_FIELDS.filter(([k]) => (r[k] ?? "").trim()).length;
  const [refreshing, setRefreshing] = useState(false);
  const m = r.metrics;
  return (
    <div className="pb-10">
      <Recolhivel titulo="Transcrição" n={r.transcript ? `${r.transcript.split(/\s+/).length} palavras` : "não transcrita"}>
        {r.transcript ? (
          <>
            <p className="text-[13px] leading-[1.6] break-words whitespace-pre-wrap">{r.transcript}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{extractCtaActions(r.transcript).map((a, i) => <span key={i} className="tagv">{a.label}{a.detail && <b className="num font-medium">“{a.detail}”</b>}</span>)}</div>
            <Button size="sm" variant="ghost" icon={<Copy size={14} />} className="mt-2 -ml-2" onClick={() => copy(r.transcript, "Transcrição copiada")}>Copiar transcrição</Button>
          </>
        ) : <p className="text-[13px] text-ink-3">Ainda não transcrita.</p>}
      </Recolhivel>

      <Recolhivel titulo="Análise" aberto={analises > 0} n={`${analises} de ${ANALYSIS_FIELDS.length}`}>
        <div className="flex flex-col gap-4">
          {ANALYSIS_FIELDS.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-2">{label}</span>
              <AutoText value={r[k]} onSave={(v) => save({ [k]: v })} rows={2} />
            </label>
          ))}
        </div>
      </Recolhivel>

      <Recolhivel titulo="Notas" aberto={!!r.notes?.trim()}>
        <AutoText value={r.notes} onSave={(notes) => save({ notes })} placeholder="Por que essa referência importa, contexto, links…" rows={3} />
      </Recolhivel>

      {r.kind === "video" && (
        <Recolhivel titulo="Marcadores" aberto={marcador != null || r.markers.length > 0} n={r.markers.length || undefined}>
          <Marcadores r={r} reload={reload} draft={marcador} setDraft={setMarcador} />
        </Recolhivel>
      )}

      <Recolhivel titulo="Métricas e origem" n={m ? `coleta ${fmtDate(m.collected_at)}` : "sem coleta"}>
        <div className="grid grid-cols-3 gap-4">
          <MetricValue value={m?.views} label="Visualizações" />
          <MetricValue value={m?.likes} label="Curtidas" />
          <MetricValue value={m?.comments} label="Comentários" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <CollectedAt m={m} />
          {r.shortcode && (
            <Button size="sm" variant="ghost" busy={refreshing} busyLabel="Coletando…" icon={<RefreshCw size={14} strokeWidth={1.5} />}
              onClick={async () => { setRefreshing(true); await act(() => api(`/api/refs/${r.id}/metrics`, { method: "POST" }), "Métricas atualizadas"); setRefreshing(false); }}>Atualizar</Button>
          )}
        </div>
        {r.engagement != null && <p className="num mt-1 text-[12px] text-ink-3">Engajamento {r.engagement.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</p>}
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-ink-3">Publicado em</dt><dd className="num">{fmtDate(r.published_at)}</dd>
          <dt className="text-ink-3">Importado em</dt><dd className="num">{fmtDateTime(r.imported_at)}</dd>
          {(r.cuts != null || r.avg_shot != null) && <><dt className="text-ink-3">Ritmo</dt><dd className="num">{r.cuts ?? "—"} cortes · plano médio {r.avg_shot != null ? `${r.avg_shot.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : "—"}</dd></>}
          {r.url && (<><dt className="text-ink-3">Original</dt><dd className="min-w-0"><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:underline"><span className="num truncate">{r.url.replace("https://www.", "")}</span><ArrowUpRight size={13} className="shrink-0" /></a></dd></>)}
        </dl>
        {r.metric_history.length > 1 && (
          <table className="num mt-3 w-full text-[12px]">
            <thead className="text-ink-3"><tr><th className="py-1 text-left font-normal">Coleta</th><th className="text-right font-normal">Views</th><th className="text-right font-normal">Curtidas</th><th className="text-right font-normal">Coment.</th></tr></thead>
            <tbody>
              {r.metric_history.map((h, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 whitespace-nowrap">{fmtDateTime(h.collected_at)}</td>
                  <td className="text-right">{fmtInt(h.views)}</td><td className="text-right">{fmtInt(h.likes)}</td><td className="text-right">{fmtInt(h.comments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Recolhivel>

      <Recolhivel titulo="Arquivo" n={fmtBytes(r.file_size)}>
        {r.file_exists ? <p className="num text-[12px] break-all text-ink-3">{r.abs_path}</p>
          : <p className="estado estado--erro !py-2 text-[13px]">Arquivo não encontrado no disco. Restaure um backup ou reimporte.</p>}
        <dl className="num mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12px] text-ink-3">
          {r.width && <><dt>Dimensão</dt><dd>{r.width}×{r.height}</dd></>}
          <dt>SHA-256</dt><dd className="truncate" title={r.file_hash ?? ""}>{r.file_hash ? `${r.file_hash.slice(0, 16)}…` : "—"}</dd>
          <dt>Fonte</dt><dd>{r.source === "manual" ? "Upload manual" : "Instagram (yt-dlp)"}</dd>
        </dl>
        {r.possible_duplicates.length > 0 && (
          <div className="estado estado--div mt-4 flex-col !items-start">
            <b className="text-[13px]">Possível duplicado</b>
            <div className="flex flex-wrap gap-1.5">{r.possible_duplicates.map((d) => <button key={d} type="button" className="tagv num" onClick={() => openRef(d)}>{refShort(d)}</button>)}</div>
          </div>
        )}
        <Button size="sm" variant="danger" icon={<Trash2 size={14} strokeWidth={1.5} />} className="mt-4" onClick={onDelete}>Excluir referência</Button>
      </Recolhivel>
    </div>
  );
}

function Marcadores({ r, reload, draft, setDraft }: { r: RefDetail; reload: () => void; draft: number | null; setDraft: (t: number | null) => void }) {
  const [label, setLabel] = useState("");
  useEffect(() => { if (draft != null) setLabel(""); }, [draft]);
  const seek = (t: number) => { const v = document.querySelector<HTMLVideoElement>("[data-viewer] .ig video"); if (v) { v.currentTime = t; v.play().catch(() => {}); } else toast("Abra o vídeo no post para ir ao momento"); };
  const novo = () => { const v = document.querySelector<HTMLVideoElement>("[data-viewer] .ig video"); setDraft(v ? v.currentTime : 0); v?.pause(); };
  return (
    <div>
      {r.markers.length > 0 && (
        <ul className="flex flex-col">
          {r.markers.map((mk) => (
            <li key={mk.id} className="group flex items-center gap-2 py-1">
              <button type="button" className="num w-12 shrink-0 text-left text-[13px] text-brasa-ink hover:underline" onClick={() => seek(mk.t)}>{fmtDuration(mk.t)}</button>
              <span className="min-w-0 flex-1 truncate text-[13px]">{mk.label || <span className="text-ink-3">sem descrição</span>}</span>
              <IconButton label="Apagar marcador" size="sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
                onClick={async () => { await act(() => api(`/api/markers/${mk.id}`, { method: "DELETE" }), "Marcador apagado"); reload(); }}><X size={14} /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {draft != null ? (
        <form className="mt-2 flex items-center gap-2" onSubmit={async (e) => {
          e.preventDefault();
          await act(() => api(`/api/refs/${r.id}/markers`, { json: { t: draft, label: label.trim() } }), "Marcador salvo");
          setDraft(null); reload();
        }}>
          <span className="num shrink-0 text-[12px] text-brasa-ink">{fmtDuration(draft)}</span>
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setDraft(null); } }}
            placeholder="O que acontece aqui? (ex.: gancho visual)" aria-label="Descrição do marcador" className="field h-9 min-w-0 flex-1 text-[13px]" />
          <Button type="submit" size="sm" variant="primary">Salvar</Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} kbd="M" className="mt-1 -ml-2" onClick={novo}>Marcar momento</Button>
      )}
    </div>
  );
}

/** Textarea que salva ao sair do campo (e com ⌘↵). */
function AutoText({ value, onSave, placeholder, rows = 2 }: { value: string; onSave: (v: string) => Promise<void> | void; placeholder?: string; rows?: number }) {
  const [v, setV] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(value ?? ""), [value]);
  const commit = async () => {
    if (v === (value ?? "")) return;
    await onSave(v);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  return (
    <div className="relative">
      <textarea className="field min-h-[60px] text-[13px]" rows={rows} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setV(value ?? ""); (e.target as HTMLTextAreaElement).blur(); } }} />
      <span className={cx("num pointer-events-none absolute right-2 bottom-2 text-[11px] text-ink-3 transition-opacity", saved ? "opacity-100" : "opacity-0")}>salvo</span>
    </div>
  );
}
