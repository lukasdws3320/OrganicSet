import { ArrowLeft, Copy, ExternalLink, Eye, GripVertical, Link2, Maximize, Plus, Trash, Unlink, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import "../funis.css";
import { InstagramPost } from "../components/InstagramPost";
import {
  E_CONVERSA, E_PAGINA, E_PERFIL, E_POST, ETAPA, ETAPAS, ICONE, NODE_H, NODE_W, PROXIMAS, PaginaViewer, PickPagina, PickPost, PickSwipe,
  PreviaPagina, SWIPE_DA_ETAPA, TAM_PADRAO, TEXTO_LABEL, caixa, caminho, distribuicao, isAusente, producaoOk, swipeOk,
  type ProducaoInfo,
  type Conexao, type EtapaApi, type FunilApi, type Perfil, type Tam, type TipoEtapa,
} from "../funis";
import { act, api, apiErrorText, isTyping, navigate, openRef, toast, useApi } from "../lib";
import { Button, ErrorState, Field, IconButton, MoreMenu, Skeleton, cx } from "../ui";
import type { RefDetail } from "../../../server/types";
import { postDaRef } from "./Viewer";

type Sel = { kind: "etapa" | "conexao"; id: string } | null;
type View = { x: number; y: number; z: number };
type Meta = Pick<FunilApi, "nome" | "origem" | "expert" | "status" | "descricao">;
type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "mover"; id: string; sx: number; sy: number; ox: number; oy: number; moveu: boolean }
  | { kind: "ligar"; de: string; px: number; py: number; sx: number; sy: number };
/** Etapa arrastada da paleta (vive fora do quadro até soltar). */
type Novo = { tipo: TipoEtapa; x: number; y: number; sx: number; sy: number; moveu: boolean };
/** Menu "próxima etapa": aparece ao clicar na bolinha ou soltar a seta no vazio. */
type MenuProx = { de: string; sx: number; sy: number; wx: number; wy: number };

const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`;
const GRADE = 20;
const snap = (n: number) => Math.round(n / GRADE) * GRADE;
/** Clique em controle de dentro da etapa (play do vídeo, botões, links) não arrasta nem move o quadro. */
const INTERATIVO = "button, a, video, input, textarea, select, iframe, [data-no-drag]";
/** Só a geometria e os vínculos vão para o arquivo; *_info é resolvido pelo servidor. */
const limpa = (e: EtapaApi) => ({ id: e.id, tipo: e.tipo, titulo: e.titulo, texto: e.texto, x: e.x, y: e.y, ref: e.ref ?? null, producao: e.producao ?? null, swipe: e.swipe ?? null, vault: e.vault ?? null, url: e.url ?? null });

export function FunilEditor({ id }: { id: string }) {
  const { data, error, reload } = useApi<FunilApi>(`/api/funis/${id}`);
  if (error && !data) return <ErrorState title="Não foi possível abrir o funil" detail={error} onRetry={reload} />;
  if (!data) return <Skeleton ratio="16/9" />;
  return <Editor key={data.id} inicial={data} />;
}

function Editor({ inicial }: { inicial: FunilApi }) {
  const perfis = useApi<Perfil[]>("/api/profiles").data ?? [];
  const [meta, setMeta] = useState<Meta>({ nome: inicial.nome, origem: inicial.origem, expert: inicial.expert, status: inicial.status, descricao: inicial.descricao });
  const [etapas, setEtapas] = useState<EtapaApi[]>(inicial.etapas);
  const [conexoes, setConexoes] = useState<Conexao[]>(inicial.conexoes);
  const [tams, setTams] = useState<Record<string, Tam>>({});
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [novo, setNovo] = useState<Novo | null>(null);
  const [menu, setMenu] = useState<MenuProx | null>(null);
  const [estado, setEstado] = useState<"salvo" | "pendente" | "salvando" | "erro">("salvo");
  const [pick, setPick] = useState<"ref" | "swipe" | "pagina" | null>(null);
  const [verPagina, setVerPagina] = useState<EtapaApi | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const tam = useCallback((id?: string) => (id && tams[id]) || TAM_PADRAO, [tams]);
  const onTam = useCallback((id: string, t: Tam) => setTams((m) => (m[id]?.w === t.w && m[id]?.h === t.h ? m : { ...m, [id]: t })), []);

  // ---------- salvar (debounce; o servidor devolve os vínculos resolvidos) ----------
  const sujo = useRef(0);
  const ultimo = useRef({ meta, etapas, conexoes });
  ultimo.current = { meta, etapas, conexoes };
  const salvar = useCallback(async () => {
    const n = sujo.current;
    setEstado("salvando");
    try {
      const { meta: m, etapas: es, conexoes: cs } = ultimo.current;
      const r = await api<FunilApi>(`/api/funis/${inicial.id}`, { method: "PUT", json: { ...m, expert: m.expert || null, etapas: es.map(limpa), conexoes: cs } });
      const info = new Map(r.etapas.map((e) => [e.id, e]));
      setEtapas((cur) => cur.map((e) => { const i = info.get(e.id); return i ? { ...e, ref_info: i.ref_info, producao_info: i.producao_info, swipe_info: i.swipe_info, vault_info: i.vault_info, url: i.url } : e; }));
      setEstado(sujo.current === n ? "salvo" : "pendente");
    } catch (e) {
      setEstado("erro");
      toast(apiErrorText(e), "erro");
    }
  }, [inicial.id]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mudou = useCallback((imediato = false) => {
    sujo.current++;
    setEstado("pendente");
    clearTimeout(timer.current);
    timer.current = setTimeout(salvar, imediato ? 0 : 700);
  }, [salvar]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => { if (estado !== "salvo") e.preventDefault(); };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [estado]);

  const setE = (fn: (es: EtapaApi[]) => EtapaApi[], imediato?: boolean) => { setEtapas(fn); mudou(imediato); };
  const setC = (fn: (cs: Conexao[]) => Conexao[]) => { setConexoes(fn); mudou(); };
  const setM = (p: Partial<Meta>) => { setMeta((m) => ({ ...m, ...p })); mudou(); };

  // ---------- enquadrar ----------
  const etapasRef = useRef(etapas);
  etapasRef.current = etapas;
  const tamRef = useRef(tam);
  tamRef.current = tam;
  const ajustar = useCallback(() => {
    const el = area.current;
    if (!el) return;
    const b = caixa(etapasRef.current, 60, (id) => tamRef.current(id));
    const z = Math.min(1, Math.max(0.2, Math.min(el.clientWidth / b.w, el.clientHeight / b.h)));
    setView({ z, x: (el.clientWidth - b.w * z) / 2 - b.x * z, y: (el.clientHeight - b.h * z) / 2 - b.y * z });
  }, []);
  useLayoutEffect(() => { ajustar(); }, [ajustar]);
  // Depois que as etapas grandes (post, página) medem o próprio tamanho, enquadra de novo uma vez.
  const enquadrouMedido = useRef(false);
  useEffect(() => {
    if (enquadrouMedido.current || !etapas.length || Object.keys(tams).length < etapas.length) return;
    enquadrouMedido.current = true;
    ajustar();
  }, [tams, etapas.length, ajustar]);

  const zoomEm = (fator: number, cx?: number, cy?: number) => {
    const el = area.current!;
    const px = cx ?? el.clientWidth / 2, py = cy ?? el.clientHeight / 2;
    setView((v) => {
      const z = Math.min(2, Math.max(0.2, v.z * fator));
      return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z };
    });
  };

  // Trackpad: pinça (ctrl+wheel) dá zoom; rolar move o quadro. Rolagem dentro da legenda de um post continua sendo da legenda.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const alvo = e.target as HTMLElement;
      if (!(e.ctrlKey || e.metaKey) && alvo.closest("[data-rola]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomEm(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const paraMundo = (clientX: number, clientY: number) => {
    const r = area.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  };

  // ---------- adicionar / remover ----------
  const criar = (tipo: TipoEtapa, x: number, y: number, depoisDe?: string) => {
    let px = snap(x), py = snap(y);
    while (etapasRef.current.some((e) => e.id !== depoisDe && Math.abs(e.x - px) < NODE_W && Math.abs(e.y - py) < NODE_H)) py += NODE_H + 40;
    const nova: EtapaApi = { id: uid("e"), tipo, titulo: ETAPA[tipo].label, texto: "", x: px, y: py, ref: null, swipe: null, vault: null, url: null };
    setE((es) => [...es, nova], true);
    if (depoisDe) setC((cs) => [...cs, { id: uid("c"), de: depoisDe, para: nova.id, rotulo: "", percentual: null }]);
    setSel({ kind: "etapa", id: nova.id });
    return nova;
  };
  const adicionar = (tipo: TipoEtapa) => {
    const el = area.current!;
    const r = el.getBoundingClientRect();
    const sel0 = sel?.kind === "etapa" ? etapas.find((e) => e.id === sel.id) : null;
    if (sel0) return criar(tipo, sel0.x + tam(sel0.id).w + 100, sel0.y, sel0.id);
    const c = paraMundo(r.left + el.clientWidth / 2, r.top + el.clientHeight / 2);
    return criar(tipo, c.x - NODE_W / 2, c.y - NODE_H / 2);
  };
  const remover = useCallback(() => {
    if (!sel) return;
    if (sel.kind === "etapa") {
      setEtapas((es) => es.filter((e) => e.id !== sel.id));
      setConexoes((cs) => cs.filter((c) => c.de !== sel.id && c.para !== sel.id));
    } else setConexoes((cs) => cs.filter((c) => c.id !== sel.id));
    setSel(null);
    mudou(true);
  }, [sel, mudou]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || document.querySelector(".modal")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); remover(); }
      if (e.key === "Escape") { setSel(null); setMenu(null); }
      if (e.key === "0" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ajustar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, remover, ajustar]);

  // ---------- arrastar da paleta para o quadro ----------
  const onPaletaDown = (e: RPointerEvent, tipo: TipoEtapa) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setNovo({ tipo, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moveu: false });
  };
  const novoRef = useRef(novo);
  novoRef.current = novo;
  useEffect(() => {
    if (!novo) return;
    const mover = (ev: PointerEvent) => setNovo((n) => n && { ...n, x: ev.clientX, y: ev.clientY, moveu: n.moveu || Math.hypot(ev.clientX - n.sx, ev.clientY - n.sy) > 5 });
    const soltar = (ev: PointerEvent) => {
      const n = novoRef.current;
      setNovo(null);
      if (!n) return;
      if (!n.moveu) { adicionar(n.tipo); return; }
      const r = area.current!.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
      const p = paraMundo(ev.clientX, ev.clientY);
      criar(n.tipo, p.x - NODE_W / 2, p.y - 20);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar, { once: true });
    return () => { window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
  }, [novo !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- ponteiro no quadro: mover etapa, ligar, arrastar o fundo ----------
  const onFundoDown = (e: RPointerEvent) => {
    const alvo = e.target as HTMLElement;
    if (e.button !== 0 || alvo.closest("[data-etapa],[data-conexao],.funil-vazio,.funil-zoom,.funil-menu") || alvo.closest(INTERATIVO)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
    setSel(null);
    setMenu(null);
  };
  const onEtapaDown = (e: RPointerEvent, et: EtapaApi) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSel({ kind: "etapa", id: et.id });
    setMenu(null);
    if ((e.target as HTMLElement).closest(INTERATIVO)) return;
    area.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: "mover", id: et.id, sx: e.clientX, sy: e.clientY, ox: et.x, oy: et.y, moveu: false });
  };
  const onPortaDown = (e: RPointerEvent, et: EtapaApi) => {
    e.stopPropagation();
    e.preventDefault();
    area.current!.setPointerCapture(e.pointerId);
    const p = paraMundo(e.clientX, e.clientY);
    setDrag({ kind: "ligar", de: et.id, px: p.x, py: p.y, sx: e.clientX, sy: e.clientY });
    setMenu(null);
  };
  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
    else if (drag.kind === "mover") {
      const dx = (e.clientX - drag.sx) / view.z, dy = (e.clientY - drag.sy) / view.z;
      if (!drag.moveu && Math.hypot(dx, dy) < 3) return;
      if (!drag.moveu) setDrag({ ...drag, moveu: true });
      setEtapas((es) => es.map((x) => (x.id === drag.id ? { ...x, x: snap(drag.ox + dx), y: snap(drag.oy + dy) } : x)));
    } else {
      const p = paraMundo(e.clientX, e.clientY);
      setDrag({ ...drag, px: p.x, py: p.y });
    }
  };
  const onUp = (e: RPointerEvent) => {
    if (drag?.kind === "mover" && drag.moveu) mudou();
    if (drag?.kind === "ligar") {
      const alvo = (document.elementsFromPoint(e.clientX, e.clientY).find((n) => (n as HTMLElement).dataset?.etapa) as HTMLElement | undefined)?.dataset.etapa;
      if (alvo && alvo !== drag.de) {
        if (!conexoes.some((c) => c.de === drag.de && c.para === alvo)) {
          const nova = { id: uid("c"), de: drag.de, para: alvo, rotulo: "", percentual: null };
          setC((cs) => [...cs, nova]);
          setSel({ kind: "conexao", id: nova.id });
        }
      } else {
        // Soltou no vazio (ou só clicou na bolinha): oferece a próxima etapa já conectada.
        const r = area.current!.getBoundingClientRect();
        const moveu = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6;
        const de = pos.get(drag.de)!;
        const w = moveu ? paraMundo(e.clientX, e.clientY) : { x: de.x + tam(de.id).w + 100, y: de.y };
        setMenu({ de: drag.de, sx: e.clientX - r.left, sy: e.clientY - r.top, wx: w.x, wy: moveu ? w.y - 20 : w.y });
      }
    }
    setDrag(null);
  };

  // ---------- render ----------
  const pos = useMemo(() => new Map(etapas.map((e) => [e.id, e])), [etapas]);
  const somas = useMemo(() => distribuicao(conexoes), [conexoes]);
  const etapaSel = sel?.kind === "etapa" ? pos.get(sel.id) ?? null : null;
  const conexaoSel = sel?.kind === "conexao" ? conexoes.find((c) => c.id === sel.id) ?? null : null;
  const patchEtapa = (id: string, p: Partial<EtapaApi>, imediato?: boolean) => setE((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)), imediato);
  const patchConexao = (p: Partial<Conexao>) => conexaoSel && setC((cs) => cs.map((c) => (c.id === conexaoSel.id ? { ...c, ...p } : c)));

  const duplicar = async () => {
    const r = await act(() => api<FunilApi>(`/api/funis/${inicial.id}/duplicar`, { json: {} }), "Cópia criada");
    if (r) navigate(`/funis/${r.id}`);
  };
  const apagar = async () => {
    await act(() => api(`/api/funis/${inicial.id}`, { method: "DELETE" }), "Funil apagado");
    navigate("/funis", { replace: true });
  };
  const [confirmaApagar, setConfirmaApagar] = useState(false);
  const deMenu = menu ? pos.get(menu.de) : null;

  return (
    <div className="funil-editor">
      <header className="funil-topo">
        <IconButton label="Voltar para Funis" onClick={() => navigate("/funis")}><ArrowLeft size={18} strokeWidth={1.5} /></IconButton>
        <input className="funil-nome" value={meta.nome} onChange={(e) => setM({ nome: e.target.value })} aria-label="Nome do funil" />
        <select className="field h-8 w-auto text-[13px]" value={meta.origem} onChange={(e) => setM({ origem: e.target.value as Meta["origem"] })} aria-label="Origem">
          <option value="proprio">Do expert</option><option value="referencia">Referência</option>
        </select>
        <select className="field h-8 w-auto max-w-[180px] text-[13px]" value={meta.expert ?? ""} onChange={(e) => setM({ expert: e.target.value || null })} aria-label="Expert">
          <option value="">Sem expert</option>{perfis.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
        </select>
        <select className="field h-8 w-auto text-[13px]" value={meta.status} onChange={(e) => setM({ status: e.target.value as Meta["status"] })} aria-label="Status">
          <option value="rascunho">Rascunho</option><option value="ativo">Ativo</option><option value="pausado">Pausado</option><option value="arquivado">Arquivado</option>
        </select>
        <span className={cx("funil-salvo num", estado === "erro" && "text-late")} aria-live="polite">
          {estado === "salvo" ? "Salvo" : estado === "salvando" ? "Salvando…" : estado === "erro" ? "Erro ao salvar" : "Alterado"}
        </span>
        <MoreMenu items={[
          { label: <span className="inline-flex items-center gap-2"><Copy size={14} aria-hidden />Duplicar (ex.: referência → funil do expert)</span>, onSelect: duplicar },
          { label: <span className="inline-flex items-center gap-2"><Trash size={14} aria-hidden />Apagar funil</span>, onSelect: () => setConfirmaApagar(true), danger: true },
        ]} />
      </header>
      {confirmaApagar && (
        <div className="estado estado--erro mb-2" role="alert">
          <div className="corpo"><b>Apagar "{meta.nome}"?</b><p>O arquivo do funil sai de library/funis/funis/. Swipes e vídeos vinculados não são tocados.</p></div>
          <div className="acoes"><Button size="sm" variant="ghost" onClick={() => setConfirmaApagar(false)}>Cancelar</Button><Button size="sm" variant="danger" onClick={apagar}>Apagar</Button></div>
        </div>
      )}

      <div className="funil-corpo">
        <aside className="funil-paleta" aria-label="Adicionar etapa">
          <p className="eyebrow px-1 text-[10px]">Arraste para o quadro ou clique</p>
          {[...new Set(ETAPAS.map((e) => e.grupo))].map((g) => (
            <div key={g}>
              <p className="funil-paleta-grupo">{g}</p>
              {ETAPAS.filter((e) => e.grupo === g).map((e) => {
                const I = ICONE[e.tipo];
                return (
                  <button key={e.tipo} type="button" className="funil-paleta-item" style={{ ["--c" as string]: e.cor }}
                    onPointerDown={(ev) => onPaletaDown(ev, e.tipo)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); adicionar(e.tipo); } }}
                    title={etapaSel ? `Clique: entra depois de "${etapaSel.titulo}" já conectada · arraste: solta onde quiser` : "Clique: adiciona no centro · arraste: solta onde quiser"}>
                    <GripVertical size={12} className="funil-paleta-alca" aria-hidden /><I size={15} strokeWidth={1.75} aria-hidden /><span>{e.label}</span><Plus size={13} className="ml-auto opacity-0" aria-hidden />
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <div ref={area} className={cx("funil-area", drag?.kind === "pan" && "is-pan", novo?.moveu && "is-soltando")} onPointerDown={onFundoDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}
          style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${GRADE * view.z}px ${GRADE * view.z}px` }}>
          <div className="funil-mundo" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            <svg className="funil-linhas" aria-hidden>
              <defs>
                <marker id="funil-seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="funil-seta" /></marker>
                <marker id="funil-seta-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="funil-seta funil-seta--on" /></marker>
              </defs>
              {conexoes.map((c) => {
                const a = pos.get(c.de), b = pos.get(c.para);
                if (!a || !b) return null;
                const p = caminho(a, b, tam(a.id), tam(b.id));
                const on = sel?.kind === "conexao" && sel.id === c.id;
                return (
                  <g key={c.id} data-conexao={c.id} onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: "conexao", id: c.id }); }} className="funil-conexao">
                    <path d={p.d} className="funil-hit" />
                    <path d={p.d} className={cx("funil-linha", on && "is-on")} markerEnd={`url(#${on ? "funil-seta-on" : "funil-seta"})`} />
                  </g>
                );
              })}
              {drag?.kind === "ligar" && pos.get(drag.de) && (
                <path d={caminho(pos.get(drag.de)!, { x: drag.px, y: drag.py - 44 }, tam(drag.de)).d} className="funil-linha funil-linha--temp" />
              )}
            </svg>
            {conexoes.map((c) => {
              const a = pos.get(c.de), b = pos.get(c.para);
              if (!a || !b || (!c.rotulo && c.percentual == null)) return null;
              const p = caminho(a, b, tam(a.id), tam(b.id));
              return (
                <button key={c.id} type="button" data-conexao={c.id} className={cx("funil-rotulo", sel?.id === c.id && "is-on")} style={{ left: p.mx, top: p.my }}
                  onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: "conexao", id: c.id }); }}>
                  {c.percentual != null && <b className="num">{c.percentual}%</b>}{c.rotulo && <span>{c.rotulo}</span>}
                </button>
              );
            })}
            {etapas.map((e) => (
              <No key={e.id} e={e} on={sel?.id === e.id} soma={somas.get(e.id)} onDown={onEtapaDown} onPorta={onPortaDown} ligando={drag?.kind === "ligar"}
                onTam={onTam} verPagina={() => setVerPagina(e)} />
            ))}
          </div>

          {!etapas.length && (
            <div className="funil-vazio">
              <p className="title-serif text-[22px]">Comece pela entrada</p>
              <p className="mt-1 text-[13px] text-ink-2">Arraste uma etapa da esquerda para cá ou clique abaixo. Depois, puxe a bolinha da direita para criar a próxima.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {(["post", "anuncio", "story"] as TipoEtapa[]).map((t) => <Button key={t} size="sm" variant="secondary" onClick={() => adicionar(t)}>{ETAPA[t].label}</Button>)}
              </div>
            </div>
          )}

          {menu && deMenu && (
            <div className="funil-menu" style={{ left: Math.min(menu.sx, (area.current?.clientWidth ?? 400) - 230), top: Math.min(menu.sy, (area.current?.clientHeight ?? 400) - 260) }} role="menu" aria-label="Próxima etapa">
              <p className="funil-menu-tit">Depois de “{deMenu.titulo}”</p>
              {[...(PROXIMAS[deMenu.tipo] ?? []), ...ETAPAS.map((x) => x.tipo).filter((t) => !(PROXIMAS[deMenu.tipo] ?? []).includes(t) && t !== "nota")].slice(0, 9).map((t) => {
                const I = ICONE[t];
                return (
                  <button key={t} type="button" role="menuitem" className="funil-menu-item" style={{ ["--c" as string]: ETAPA[t].cor }}
                    onClick={() => { criar(t, menu.wx, menu.wy, menu.de); setMenu(null); }}>
                    <I size={14} strokeWidth={1.75} aria-hidden />{ETAPA[t].label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="funil-zoom" onPointerDown={(e) => e.stopPropagation()}>
            <IconButton size="sm" label="Diminuir zoom" onClick={() => zoomEm(1 / 1.2)}><ZoomOut size={15} strokeWidth={1.5} /></IconButton>
            <span className="num w-10 text-center text-[11px] text-ink-3">{Math.round(view.z * 100)}%</span>
            <IconButton size="sm" label="Aumentar zoom" onClick={() => zoomEm(1.2)}><ZoomIn size={15} strokeWidth={1.5} /></IconButton>
            <IconButton size="sm" label="Enquadrar tudo (⌘0)" onClick={ajustar}><Maximize size={15} strokeWidth={1.5} /></IconButton>
          </div>
        </div>

        <aside className={cx("funil-inspetor", (etapaSel || conexaoSel) && "is-aberto")} aria-label="Propriedades">
          {etapaSel ? (
            <InspetorEtapa e={etapaSel} patch={(p, i) => patchEtapa(etapaSel.id, p, i)} remover={remover} onPick={setPick} fechar={() => setSel(null)}
              verPagina={() => setVerPagina(etapaSel)}
              saindo={conexoes.filter((c) => c.de === etapaSel.id).map((c) => ({ c, para: pos.get(c.para) }))}
              selecionarConexao={(cid) => setSel({ kind: "conexao", id: cid })} />
          ) : conexaoSel ? (
            <InspetorConexao c={conexaoSel} de={pos.get(conexaoSel.de)} para={pos.get(conexaoSel.para)} soma={somas.get(conexaoSel.de)} patch={patchConexao} remover={remover} fechar={() => setSel(null)} />
          ) : (
            <div className="p-4 text-[13px] text-ink-2">
              <p className="font-medium text-ink">Como usar</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4">
                <li>Arraste uma etapa da esquerda para o quadro, ou clique nela. Com uma etapa selecionada, o clique cria a nova depois dela, já conectada.</li>
                <li>Puxe a bolinha da direita até outra etapa para ligar. Soltou no vazio ou só clicou na bolinha? Aparece a lista de próximas etapas.</li>
                <li>Clique na seta para dar rótulo e % de distribuição (ex.: 70% página, 30% checkout).</li>
                <li>Post vinculado aparece completo (vídeo, legenda, @). Página vinculada aparece com a prévia; “Ver página” abre a página inteira.</li>
                <li>Arraste o fundo ou role para mover; pinça ou ⌘+rolar para zoom; Delete apaga o selecionado.</li>
              </ul>
              <Field label="Descrição do funil" className="mt-5">
                <textarea className="field" rows={5} value={meta.descricao} onChange={(e) => setM({ descricao: e.target.value })} placeholder="De onde veio, o que testa, o que observar…" />
              </Field>
              <p className="num mt-4 text-[11px] text-ink-3">Arquivo: library/funis/funis/{inicial.id}.json</p>
            </div>
          )}
        </aside>
      </div>

      {novo?.moveu && (
        <div className="funil-fantasma" style={{ left: novo.x, top: novo.y, ["--c" as string]: ETAPA[novo.tipo].cor }} aria-hidden>
          {(() => { const I = ICONE[novo.tipo]; return <I size={14} strokeWidth={1.75} />; })()}{ETAPA[novo.tipo].label}
        </div>
      )}
      {pick === "ref" && etapaSel && (
        <PickPost expert={meta.expert ?? null} onClose={() => setPick(null)}
          onPickProducao={(id) => { patchEtapa(etapaSel.id, { producao: id, ref: null }, true); setPick(null); }}
          onPickRef={(r) => { patchEtapa(etapaSel.id, { ref: r, producao: null }, true); setPick(null); }} />
      )}
      {pick === "swipe" && etapaSel && <PickSwipe tipo={SWIPE_DA_ETAPA[etapaSel.tipo]} onClose={() => setPick(null)} onPick={(s) => { patchEtapa(etapaSel.id, { swipe: s }, true); setPick(null); }} />}
      {pick === "pagina" && etapaSel && (
        <PickPagina tipo={etapaSel.tipo} onClose={() => setPick(null)}
          onSwipe={(s) => { patchEtapa(etapaSel.id, { swipe: s, vault: null }, true); setPick(null); }}
          onVault={(v) => { patchEtapa(etapaSel.id, { vault: v, swipe: null }, true); setPick(null); }} />
      )}
      {verPagina && (() => {
        const s = swipeOk(verPagina.swipe_info);
        return <PaginaViewer vault={verPagina.vault ?? s?.vault?.rel ?? null} url={verPagina.url ?? (s?.url || null)} titulo={s?.titulo ?? verPagina.vault_info?.nome ?? verPagina.titulo} onClose={() => setVerPagina(null)} />;
      })()}
    </div>
  );
}

// ---------- etapa no quadro ----------

/** Post completo da biblioteca dentro da etapa (mesmo post do visualizador: vídeo, legenda, @). */
function PostDaEtapa({ refId }: { refId: string }) {
  const { data, error } = useApi<RefDetail>(`/api/refs/${refId}`);
  if (error) return <p className="funil-no-aviso">{refId} não está mais na biblioteca.</p>;
  if (!data) return <div className="esq aspect-[9/16] w-full rounded-r2" aria-hidden />;
  return (
    <div className="funil-no-post">
      <InstagramPost compact post={postDaRef(data)}
        actions={<Button size="sm" variant="ghost" icon={<Eye size={13} aria-hidden />} onClick={() => openRef(refId)}>Abrir</Button>} />
    </div>
  );
}

/** Post do próprio expert (vídeo editado ou carrossel feito no Hub) com a legenda que foi ou vai ao ar. */
function MeuPostDaEtapa({ p }: { p: ProducaoInfo }) {
  const post = {
    id: p.id, formato: p.tipo === "video" ? "reel" as const : "carrossel" as const, proporcao: p.tipo === "video" ? "9/16" : "4/5",
    perfil: { nome: p.perfil ?? undefined }, capa: p.capa,
    midia_video: p.video ? { src: p.video, poster: null } : null,
    slides: p.slides.map((src, i) => ({ n: i + 1, src, estado: "pronto" as const })), total_previsto: p.slides.length || undefined,
    legenda: p.legenda, contexto: [p.etapa === "postado" ? "Postado" : p.etapa === "pronto" ? "Pronto" : p.etapa, p.postado_em ? p.postado_em.slice(0, 10).split("-").reverse().join("/") : null].filter(Boolean).join(" · "),
  };
  return (
    <div className="funil-no-post">
      <InstagramPost compact post={post}
        actions={p.post_url ? <a className="btn btn--ghost btn--sm" href={p.post_url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden />No Instagram</a>
          : p.hub_url ? <Button size="sm" variant="ghost" icon={<Eye size={13} aria-hidden />} onClick={() => navigate(p.hub_url!)}>Abrir</Button> : undefined} />
    </div>
  );
}

/** Página da etapa: print/captura (do swipe ou do vault) ou a página viva reduzida. */
function paginaDaEtapa(e: EtapaApi) {
  const s = swipeOk(e.swipe_info);
  const v = e.vault_info && !e.vault_info.ausente ? e.vault_info : s?.vault ?? null;
  return { capa: s?.imagem ?? v?.capa ?? null, entrada: v?.entrada ?? null, nome: s?.titulo ?? v?.nome ?? null, temAlgo: !!(s || v || e.url) };
}

function No({ e, on, soma, onDown, onPorta, ligando, onTam, verPagina }: {
  e: EtapaApi; on: boolean; soma?: number; ligando: boolean;
  onDown: (ev: RPointerEvent, e: EtapaApi) => void; onPorta: (ev: RPointerEvent, e: EtapaApi) => void;
  onTam: (id: string, t: Tam) => void; verPagina: () => void;
}) {
  const t = ETAPA[e.tipo];
  const I = ICONE[e.tipo];
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const n = el.current;
    if (!n) return;
    const medir = () => onTam(e.id, { w: n.offsetWidth, h: n.offsetHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(n);
    return () => ro.disconnect();
  }, [e.id, onTam]);

  const s = swipeOk(e.swipe_info);
  const meuPost = E_POST.has(e.tipo) ? producaoOk(e.producao_info) : null;
  const post = E_POST.has(e.tipo) && (!!e.ref || !!meuPost);
  const pag = E_PAGINA.has(e.tipo) ? paginaDaEtapa(e) : null;
  const vinculos = [e.ref, e.producao, e.swipe, e.vault, e.url].filter(Boolean).length;
  const quebrado = [e.ref_info, e.swipe_info, e.producao_info].some(isAusente) || !!e.vault_info?.ausente;
  const textoConversa = s?.texto || e.texto;

  return (
    <div ref={el} data-etapa={e.id} className={cx("funil-no", post && "funil-no--post", pag?.temAlgo && "funil-no--pagina", on && "is-on", ligando && "is-alvo")}
      style={{ left: e.x, top: e.y, ["--c" as string]: t.cor }} onPointerDown={(ev) => onDown(ev, e)} role="group" aria-label={`${t.label}: ${e.titulo}`}>
      <span className="funil-porta funil-porta--in" aria-hidden />
      <div className="funil-no-cab">
        <span className="funil-no-tipo"><I size={12} strokeWidth={1.9} aria-hidden />{t.label}</span>
        <span className="funil-no-titulo">{e.titulo || t.label}</span>
      </div>
      {meuPost ? <MeuPostDaEtapa p={meuPost} /> : post ? <PostDaEtapa refId={e.ref!} />
        : pag?.temAlgo ? (
          <div className="funil-no-pagina">
            <div className="funil-no-celular"><PreviaPagina capa={pag.capa} entrada={pag.capa ? null : pag.entrada} className="size-full" /></div>
            {pag.nome && <p className="funil-no-texto">{pag.nome}</p>}
            <Button size="sm" variant="secondary" icon={<Eye size={13} aria-hidden />} onClick={verPagina}>Ver página</Button>
          </div>
        )
        : E_CONVERSA.has(e.tipo) && textoConversa ? <p className={cx(e.tipo === "comentario" ? "funil-no-comentario" : "funil-dm", "funil-no-msg")}>{textoConversa}</p>
        : E_PERFIL.has(e.tipo) && (s || e.texto) ? (
          <p className="funil-bio funil-no-msg">{s?.autor && <b>{s.autor}</b>}<span>{s?.texto || e.texto}</span>{(s?.url || e.url) && <span className="funil-bio-link">{(s?.url || e.url)!.replace(/^https?:\/\//, "")}</span>}</p>
        )
        : e.texto ? <p className="funil-no-texto">{e.texto}</p> : null}
      {(vinculos > 0 || soma != null) && (
        <span className="funil-no-rodape">
          {vinculos > 0 && <span className={cx(quebrado && "text-late")} title={quebrado ? "Algum vínculo não existe mais" : "Vínculos"}><Link2 size={11} aria-hidden />{vinculos}</span>}
          {soma != null && <span className={cx(soma !== 100 && "text-warn")} title="Soma das saídas">{soma}%</span>}
        </span>
      )}
      <span className="funil-porta funil-porta--out" onPointerDown={(ev) => onPorta(ev, e)} title="Puxe até outra etapa · clique para escolher a próxima" />
    </div>
  );
}

// ---------- inspetores ----------

function Cabeca({ titulo, cor, fechar }: { titulo: string; cor?: string; fechar: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-3">
      {cor && <span className="size-2.5 rounded-full" style={{ background: cor }} aria-hidden />}
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{titulo}</p>
      <IconButton size="sm" label="Fechar" onClick={fechar}><X size={15} strokeWidth={1.5} /></IconButton>
    </div>
  );
}

function InspetorEtapa({ e, patch, remover, onPick, fechar, verPagina, saindo, selecionarConexao }: {
  e: EtapaApi; patch: (p: Partial<EtapaApi>, imediato?: boolean) => void; remover: () => void; onPick: (k: "ref" | "swipe" | "pagina") => void; fechar: () => void;
  verPagina: () => void; saindo: { c: Conexao; para?: EtapaApi }[]; selecionarConexao: (id: string) => void;
}) {
  const tl = TEXTO_LABEL[e.tipo] ?? { label: "Texto", ph: "" };
  const soma = saindo.reduce((a, s) => a + (s.c.percentual ?? 0), 0);
  const algumPct = saindo.some((s) => s.c.percentual != null);
  const ri = e.ref_info && !isAusente(e.ref_info) ? (e.ref_info as Exclude<typeof e.ref_info, { ausente: true }>) : null;
  const mp = producaoOk(e.producao_info);
  const si = swipeOk(e.swipe_info);
  const pag = paginaDaEtapa(e);
  const nomeSwipe = { dm: "DM", bio: "bio", pagina: "página", quiz: "quiz" }[SWIPE_DA_ETAPA[e.tipo] ?? "dm"];

  return (
    <div className="flex h-full flex-col">
      <Cabeca titulo={ETAPA[e.tipo].label} cor={ETAPA[e.tipo].cor} fechar={fechar} />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <Field label="Tipo">
          <select className="field" value={e.tipo} onChange={(ev) => patch({ tipo: ev.target.value as TipoEtapa })}>
            {ETAPAS.map((t) => <option key={t.tipo} value={t.tipo}>{t.grupo} · {t.label}</option>)}
          </select>
        </Field>
        <Field label="Título"><input className="field" value={e.titulo} onChange={(ev) => patch({ titulo: ev.target.value })} /></Field>
        <Field label={tl.label}><textarea className="field" rows={4} value={e.texto} onChange={(ev) => patch({ texto: ev.target.value })} placeholder={tl.ph} /></Field>

        <div>
          <p className="mb-2 text-[13px] font-medium">Vínculo</p>
          <div className="flex flex-col gap-2">
            {/* Post / anúncio / story: o post da biblioteca. */}
            {E_POST.has(e.tipo) && (e.producao ? (
              <Vinculo rotulo={mp?.tipo === "carrossel" ? "Meu carrossel" : "Meu post"} titulo={mp ? (mp.legenda?.split("\n")[0] || mp.titulo) : `${e.producao} (não está mais na produção)`}
                capa={mp?.capa ?? null} quebrado={!mp} tirar={() => patch({ producao: null }, true)} trocar={() => onPick("ref")}
                abrir={mp?.post_url ? () => window.open(mp.post_url!, "_blank", "noopener") : mp?.hub_url ? () => navigate(mp.hub_url!) : undefined}
                abrirRotulo={mp?.post_url ? "Ver no Instagram" : "Abrir no Hub"} />
            ) : e.ref ? (
              <Vinculo rotulo="Post da biblioteca" titulo={ri ? `${ri.username ? "@" + ri.username : "Sem @"} · ${e.ref}` : `${e.ref} (não está mais na biblioteca)`}
                capa={ri?.capa ?? null} quebrado={!ri} abrir={() => openRef(e.ref!)} tirar={() => patch({ ref: null }, true)} trocar={() => onPick("ref")} />
            ) : <Button size="sm" variant="secondary" onClick={() => onPick("ref")}>Vincular post (meu ou da biblioteca)</Button>)}

            {/* Página / quiz / checkout / upsell / obrigado: página do swipe ou do vault. */}
            {E_PAGINA.has(e.tipo) && (e.swipe || e.vault ? (
              <Vinculo rotulo={e.swipe ? "Página do swipe" : "Página do vault"} titulo={pag.nome ?? e.vault ?? e.swipe ?? ""} capa={pag.capa}
                quebrado={isAusente(e.swipe_info) || !!e.vault_info?.ausente} abrir={verPagina} abrirRotulo="Ver página"
                tirar={() => patch({ swipe: null, vault: null }, true)} trocar={() => onPick("pagina")} />
            ) : <Button size="sm" variant="secondary" onClick={() => onPick("pagina")}>{e.tipo === "quiz" ? "Vincular quiz" : "Vincular página"}</Button>)}

            {/* Comentário / DM / WhatsApp / bio / link: item do swipe. */}
            {(E_CONVERSA.has(e.tipo) || E_PERFIL.has(e.tipo)) && (e.swipe ? (
              <Vinculo rotulo={`${nomeSwipe[0].toUpperCase()}${nomeSwipe.slice(1)} do swipe`} titulo={si ? si.titulo : `${e.swipe} (apagado do swipe)`} capa={null} texto={si?.texto}
                quebrado={!si} abrir={si ? () => navigate(`/funis?aba=${si.tipo}`) : undefined} tirar={() => patch({ swipe: null }, true)} trocar={() => onPick("swipe")} />
            ) : <Button size="sm" variant="secondary" onClick={() => onPick("swipe")}>Vincular {nomeSwipe} do swipe</Button>)}

            <Field label={E_PAGINA.has(e.tipo) ? "Link da página no ar" : E_POST.has(e.tipo) ? "Link do post" : "Link"}>
              <div className="flex gap-1.5">
                <input className="field" value={e.url ?? ""} onChange={(ev) => patch({ url: ev.target.value || null })} placeholder="https://…" />
                {e.url && <IconButton label="Abrir link" onClick={() => window.open(/^https?:/.test(e.url!) ? e.url! : `https://${e.url}`, "_blank", "noopener")}><ExternalLink size={15} strokeWidth={1.5} /></IconButton>}
              </div>
            </Field>
            {E_PAGINA.has(e.tipo) && !e.swipe && !e.vault && e.url && <Button size="sm" variant="ghost" icon={<Eye size={13} aria-hidden />} onClick={verPagina}>Ver página do link</Button>}
          </div>
        </div>

        {!!saindo.length && (
          <div>
            <p className="mb-2 text-[13px] font-medium">Saídas {algumPct && <span className={cx("num ml-1 text-[12px]", soma === 100 ? "text-ink-3" : "text-warn")}>· {soma}% {soma !== 100 && "(não soma 100)"}</span>}</p>
            <ul className="flex flex-col gap-1">
              {saindo.map(({ c, para }) => (
                <li key={c.id}>
                  <button type="button" className="funil-saida" onClick={() => selecionarConexao(c.id)}>
                    <span className="min-w-0 flex-1 truncate">→ {para?.titulo ?? "?"}{c.rotulo && <span className="text-ink-3"> · {c.rotulo}</span>}</span>
                    <span className="num">{c.percentual != null ? `${c.percentual}%` : "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="border-t border-line p-3"><Button variant="danger" size="sm" icon={<Trash size={14} aria-hidden />} onClick={remover}>Remover etapa</Button></div>
    </div>
  );
}

function Vinculo({ rotulo, titulo, capa, texto, quebrado, abrir, abrirRotulo = "Abrir", tirar, trocar }: {
  rotulo: string; titulo: string; capa: string | null; texto?: string; quebrado?: boolean; abrir?: () => void; abrirRotulo?: string; tirar: () => void; trocar?: () => void;
}) {
  return (
    <div className={cx("funil-vinculo", quebrado && "is-quebrado")}>
      {capa ? <img src={capa} alt="" /> : !texto && <span className="funil-vinculo-sem" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-3">{rotulo}</p>
        <p className="line-clamp-2 text-[12.5px] leading-snug">{titulo}</p>
        {texto && <p className="mt-1 line-clamp-3 text-[11.5px] whitespace-pre-line text-ink-2">{texto}</p>}
        <div className="mt-1 flex flex-wrap gap-x-2">
          {abrir && <button type="button" className="funil-link" onClick={abrir}>{abrirRotulo}</button>}
          {trocar && <button type="button" className="funil-link" onClick={trocar}>Trocar</button>}
          <button type="button" className="funil-link" onClick={tirar}><Unlink size={11} aria-hidden /> Tirar</button>
        </div>
      </div>
    </div>
  );
}

function InspetorConexao({ c, de, para, soma, patch, remover, fechar }: {
  c: Conexao; de?: EtapaApi; para?: EtapaApi; soma?: number; patch: (p: Partial<Conexao>) => void; remover: () => void; fechar: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <Cabeca titulo="Conexão" fechar={fechar} />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <p className="text-[13px]"><b>{de?.titulo}</b> <span className="text-ink-3">→</span> <b>{para?.titulo}</b></p>
        <Field label="Rótulo" hint="O que faz a pessoa passar: “comenta RECEITA”, “clica no link”, “não comprou”…">
          <input className="field" autoFocus value={c.rotulo} onChange={(e) => patch({ rotulo: e.target.value })} />
        </Field>
        <Field label="Distribuição (%)" hint={soma != null ? `Saídas de "${de?.titulo}" somam ${soma}%${soma !== 100 ? " — ajuste para 100" : ""}.` : "Opcional: quanto do tráfego desta etapa vai por aqui."}>
          <input className="field num" type="number" min={0} max={100} value={c.percentual ?? ""} onChange={(e) => patch({ percentual: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) })} />
        </Field>
      </div>
      <div className="border-t border-line p-3"><Button variant="danger" size="sm" icon={<Trash size={14} aria-hidden />} onClick={remover}>Remover conexão</Button></div>
    </div>
  );
}
