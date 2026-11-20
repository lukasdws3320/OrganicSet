import { AlertTriangle, ArrowRight, Check, ChevronDown, Clock, CopyCheck, FileSpreadsheet, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { extractUrls, parseShortcode } from "../../../server/text";
import type { ImportItem } from "../../../server/types";
import { act, api, fmtBytes, fmtDateTime, invalidate, media, navigate, openRef, plural, toast, useApi } from "../lib";
import { Button, CheckList, cx, Field, IconButton, PageHeader, Popover, Skeleton, Working } from "../ui";

interface Job { id: number; source: string; created_at: string; items: ImportItem[]; assign: any }

const STATUS_TXT: Record<ImportItem["status"], string> = { pendente: "Na fila", baixando: "Baixando", ok: "Importado", duplicado: "Duplicado", erro: "Erro" };

/** Lotes de importação com progresso ao vivo por SSE. */
function useJobs() {
  const { data: jobsData, error, reload } = useApi<Job[]>("/api/import/jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => { if (jobsData) setJobs(jobsData); }, [jobsData]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/import/events");
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "item") {
        setJobs((js) => js.map((j) => (j.id === ev.item.job_id ? { ...j, items: j.items.map((i) => (i.id === ev.item.id ? ev.item : i)) } : j)));
        if (ev.item.status === "ok") invalidate();
      } else if (ev.type === "job") {
        api<Job>(`/api/import/jobs/${ev.job_id}`).then((j) => setJobs((js) => [j, ...js.filter((x) => x.id !== j.id)])).catch(() => {});
      }
    };
    return () => es.close();
  }, []);

  const running = jobs.flatMap((j) => j.items).filter((i) => i.status === "pendente" || i.status === "baixando").length;
  return { jobs, loaded: !!jobsData, error, reload, running };
}

/** Título de seção padrão do Hub (`.sec-h`, serif 20). */
function Sec({ title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="sec-h [&_h2]:text-[20px]">
      <h2>{title}</h2>
      {meta && <span className="mono text-[12px]">{meta}</span>}
      {action && <span className="sp">{action}</span>}
    </div>
  );
}

/** /importar: histórico completo + upload de arquivo. A importação rápida é o botão global "+ Importar ⌘I". */
export function Import() {
  const { jobs, loaded, error, reload, running } = useJobs();

  return (
    <div>
      <PageHeader
        title={<>Importar <em>vídeos</em></>}
        meta={running ? <span className="num">{plural(running, "link", "links")} na fila · pode continuar usando o Hub</span> : "Links públicos do Instagram, planilha CSV ou arquivo de vídeo do seu computador."}
      />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <section>
            <Sec title={<>Links e <em>CSV</em></>} />
            <LinksForm />
          </section>
          <ManualUpload />
        </div>
        <section className="min-w-0">
          <Sec title={<>Resultado por <em>link</em></>} meta={loaded ? plural(jobs.length, "lote", "lotes") : undefined} />
          {error && !loaded && (
            <div className="estado estado--erro" role="alert"><AlertTriangle aria-hidden /><div className="corpo"><b>Histórico indisponível</b><p className="mono">{error}</p></div><div className="acoes"><Button size="sm" onClick={reload}>Tentar de novo</Button></div></div>
          )}
          {!loaded && !error && <div className="flex flex-col gap-3"><Skeleton ratio="8/1" /><Skeleton ratio="8/1" /></div>}
          {loaded && !jobs.length && <p className="rounded-r3 border border-dashed border-line-2 px-5 py-10 text-center text-[13px] text-ink-2">As importações aparecem aqui, com o resultado de cada link.</p>}
          <ol className="flex flex-col gap-3">
            {jobs.map((j, i) => <JobCard key={j.id} job={j} defaultOpen={i === 0} />)}
          </ol>
        </section>
      </div>
    </div>
  );
}

/**
 * Sheet global "+ Importar ⌘I" (SPEC §5.1): colar link(s) ou CSV sem sair da tela. O resultado do último lote
 * aparece embaixo, ao vivo; /importar guarda o histórico e o upload de arquivo.
 */
export function ImportSheet({ onClose }: { onClose: () => void }) {
  const { jobs, running } = useJobs();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [desde] = useState(() => Date.now());
  const recentes = jobs.filter((j) => new Date(j.created_at).getTime() >= desde - 1000);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = box.current;
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length > 0);
    root?.querySelector<HTMLElement>("input[data-primeiro]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector(".pop")) return; // o Popover fecha primeiro
        e.preventDefault(); e.stopPropagation(); closeRef.current();
      }
      if (e.key === "Tab") {
        const n = focusable(), first = n[0], last = n.at(-1);
        if (!first) return;
        if (e.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; prev?.focus?.({ preventScroll: true }); };
  }, []);

  const toHistorico = () => { onClose(); navigate("/importar"); };

  return (
    <div className="modal items-stretch! justify-items-end! p-0!" role="dialog" aria-modal aria-labelledby="sheet-importar-t">
      <div className="modal-scrim fade-in" onClick={onClose} />
      <div ref={box} className="fade-in relative flex h-dvh w-full max-w-[560px] flex-col overflow-hidden border-l border-line bg-card text-ink shadow-[var(--sh-2)]">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="sheet-importar-t" className="title-serif text-[26px] leading-tight">Importar <em>link</em></h2>
            <p className="mt-1 text-[13px] text-ink-2">Reels, posts e carrosséis públicos. Baixa mídia, capa, legenda e métricas.</p>
          </div>
          <IconButton label="Fechar" kbd="Esc" onClick={onClose}><X size={18} strokeWidth={1.5} /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <LinksForm compact />
          {recentes.length > 0 && (
            <section className="mt-8">
              <Sec title={<>Desta <em>vez</em></>} meta={running ? `${plural(running, "link", "links")} na fila` : "concluído"} />
              <ol className="flex flex-col gap-3">
                {recentes.map((j) => <JobCard key={j.id} job={j} defaultOpen />)}
              </ol>
            </section>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3 sm:px-6">
          <span className="min-w-0 flex-1 text-[12px] text-ink-3">Enviar arquivo de vídeo e ver lotes antigos: Importações.</span>
          <Button variant="secondary" size="sm" onClick={toHistorico}>Abrir Importações</Button>
        </div>
      </div>
    </div>
  );
}

// ---------- links e CSV ----------

function useAssignOptions() {
  const clients = useApi<any[]>("/api/clients").data?.filter(e => e.ativo !== false) ?? [];
  const categories = useApi<any[]>("/api/categories").data ?? [];
  const collections = (useApi<any[]>("/api/collections").data ?? []).filter((c) => c.kind === "manual");
  return { clients, categories, collections };
}

function AssignBar({ value, onChange }: { value: { clients: number[]; categories: number[]; collection?: number }; onChange: (v: any) => void }) {
  const { clients, categories, collections } = useAssignOptions();
  const pill = (label: string, n: number, open: boolean, toggle: () => void) => (
    <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" className={cx("facet", n > 0 && "on")}>
      <span>{label}</span>{n > 0 && <span className="num">{n}</span>}<ChevronDown size={13} strokeWidth={1.5} aria-hidden />
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-ink-2">Já associar a</span>
      <Popover width={260} trigger={({ open, toggle }) => pill("Experts", value.clients.length, open, toggle)}>
        {() => <CheckList options={clients.map((c) => ({ value: c.id, label: c.name, color: c.color }))} value={value.clients} onChange={(v) => onChange({ ...value, clients: v })} empty="Nenhum expert cadastrado." />}
      </Popover>
      <Popover width={260} trigger={({ open, toggle }) => pill("Categorias", value.categories.length, open, toggle)}>
        {() => <CheckList options={categories.map((c) => ({ value: c.id, label: c.name }))} value={value.categories} onChange={(v) => onChange({ ...value, categories: v })} />}
      </Popover>
      <Popover width={260} trigger={({ open, toggle }) => pill(value.collection ? collections.find((c) => c.id === value.collection)?.name ?? "Quadro" : "Quadro", value.collection ? 1 : 0, open, toggle)}>
        {(close) => (
          <div className="flex flex-col">
            {value.collection && <button type="button" className="pop-opt" onClick={() => (onChange({ ...value, collection: undefined }), close())}><span className="lb text-ink-2">Nenhum quadro</span></button>}
            {collections.map((c) => <button type="button" key={c.id} className="pop-opt" aria-checked={value.collection === c.id} role="menuitemradio" onClick={() => (onChange({ ...value, collection: c.id }), close())}><span className="lb">{c.name}</span>{value.collection === c.id && <Check size={14} aria-hidden />}</button>)}
            {!collections.length && <p className="pop-empty">Nenhum quadro manual.</p>}
          </div>
        )}
      </Popover>
    </div>
  );
}

function LinksForm({ compact = false }: { compact?: boolean }) {
  const [single, setSingle] = useState("");
  const [text, setText] = useState("");
  const [assign, setAssign] = useState<{ clients: number[]; categories: number[]; collection?: number }>({ clients: [], categories: [] });
  const [busy, setBusy] = useState(false);
  const csv = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    const urls = extractUrls(text);
    const codes = urls.map(parseShortcode);
    const valid = new Set(codes.filter(Boolean));
    return { urls, valid: valid.size, invalid: codes.filter((c) => !c).length, repeated: codes.filter(Boolean).length - valid.size };
  }, [text]);

  const send = async (urls: string[], clear: () => void) => {
    setBusy(true);
    const job = await act(() => api<Job>("/api/import", { json: { urls, ...assign } }));
    setBusy(false);
    if (job) {
      clear();
      const queued = job.items.filter((i) => i.status === "pendente").length;
      toast(queued ? `${plural(queued, "link entrou", "links entraram")} na fila` : "Nenhum link novo para baixar — veja o resultado ao lado");
    }
  };

  const sendCsv = async (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("assign", JSON.stringify(assign));
    setBusy(true);
    const job = await act(() => api<Job>("/api/import/csv", { body: fd }));
    setBusy(false);
    if (job) toast(`CSV lido: ${plural(job.items.length, "link", "links")}`);
    if (csv.current) csv.current.value = "";
  };

  return (
    <section className="flex flex-col gap-5">
      <form onSubmit={(e) => { e.preventDefault(); if (single.trim()) send([single.trim()], () => setSingle("")); }}>
        <Field label="Um link">
          <div className="flex gap-2">
            <input data-primeiro className="field num text-[13px]" value={single} onChange={(e) => setSingle(e.target.value)} placeholder="https://www.instagram.com/reel/…" aria-label="Link do Instagram" />
            <Button type="submit" variant="primary" disabled={!single.trim() || busy}>Importar</Button>
          </div>
        </Field>
      </form>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[13px] font-medium">Vários links de uma vez</span>
          <span className="num text-[12px] text-ink-3">
            {parsed.urls.length ? <>{parsed.valid} válidos{parsed.invalid > 0 && <> · <span className="text-late">{parsed.invalid} inválidos</span></>}{parsed.repeated > 0 && <> · {parsed.repeated} repetidos</>}</> : "cole texto livre: só os links são lidos"}
          </span>
        </div>
        <textarea
          className={cx("field num text-[13px]", compact ? "min-h-[140px]" : "min-h-[200px]")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"https://www.instagram.com/p/…\nhttps://www.instagram.com/perfil/reel/…\n\nPode colar a lista com anotações: o texto em volta é ignorado."}
          aria-label="Vários links"
        />
      </div>

      <AssignBar value={assign} onChange={setAssign} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!parsed.urls.length || busy} onClick={() => send(parsed.urls, () => setText(""))}>
          {parsed.urls.length ? `Importar ${plural(parsed.urls.length, "link", "links")}` : "Importar links"}
        </Button>
        <input ref={csv} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && sendCsv(e.target.files[0])} />
        <Button icon={<FileSpreadsheet size={16} strokeWidth={1.5} />} onClick={() => csv.current?.click()} disabled={busy}>Importar CSV</Button>
        <span className="text-[12px] text-ink-3">Qualquer coluna com link do Instagram.</span>
      </div>
      <p className={cx("text-[12px] leading-relaxed text-ink-3", compact && "hidden")}>
        Um link por vez, com intervalo entre downloads para o Instagram não bloquear. Links inválidos, privados ou removidos ficam marcados com o motivo e não interrompem os outros.
      </p>
    </section>
  );
}

// ---------- upload manual ----------

function ManualUpload() {
  const { clients, categories } = useAssignOptions();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [f, setF] = useState({ username: "", display_name: "", url: "", published_at: "", caption: "", views: "", likes: "", comments: "" });
  const [sel, setSel] = useState<{ clients: number[]; categories: number[] }>({ clients: [], categories: [] });
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    for (const [k, v] of Object.entries(f)) if (v) fd.set(k, v);
    if (sel.clients.length) fd.set("clients", sel.clients.join(","));
    if (sel.categories.length) fd.set("categories", sel.categories.join(","));
    // XHR para ter progresso de envio.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/import/manual");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(e.loaded / e.total);
    xhr.onload = () => {
      setProgress(null);
      const data = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 400) {
        toast(data.error ?? "Falha no envio", "erro");
        if (data.existing) openRef(data.existing);
        return;
      }
      toast(`${data.id} salva na biblioteca`);
      setFile(null);
      setF({ username: "", display_name: "", url: "", published_at: "", caption: "", views: "", likes: "", comments: "" });
      invalidate();
      openRef(data.id);
    };
    xhr.onerror = () => { setProgress(null); toast("Falha de conexão com o app", "erro"); };
    setProgress(0);
    xhr.send(fd);
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <section id="arquivo" className="border-t border-line pt-8">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-r2 text-left">
        <span>
          <span className="block font-serif text-[20px] leading-tight">Enviar arquivo de <em>vídeo</em></span>
          <span className="mt-1 block text-[13px] text-ink-2">Para vídeos obtidos legitimamente (seus, de experts, ou baixados com autorização).</span>
        </span>
        <ChevronDown size={18} strokeWidth={1.5} className={cx("shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <form className="fade-in mt-6 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const x = e.dataTransfer.files[0]; if (x) setFile(x); }}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
            className={cx("flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed px-6 py-10 text-center transition-colors", drag ? "border-ink bg-sunken" : "border-line-2 hover:border-ink-3")}
          >
            <Upload size={22} strokeWidth={1.5} className="text-ink-3" aria-hidden />
            {file ? (
              <span className="text-[14px]"><span className="font-medium">{file.name}</span> <span className="num text-muted">· {fmtBytes(file.size)}</span></span>
            ) : (
              <span className="text-[14px] text-ink-2">Arraste um vídeo aqui ou <span className="text-ink underline underline-offset-4">escolha no computador</span></span>
            )}
            <span className="text-[12px] text-ink-3">MP4, MOV, WebM… é convertido para MP4 se preciso. Arquivo repetido é recusado.</span>
            <input ref={input} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="@usuário do criador"><input className="field" value={f.username} onChange={set("username")} placeholder="@perfil" /></Field>
            <Field label="Nome do perfil"><input className="field" value={f.display_name} onChange={set("display_name")} /></Field>
            <Field label="Link original" hint="Opcional. Evita duplicar se o post for importado depois."><input className="field num text-[13px]" value={f.url} onChange={set("url")} placeholder="https://www.instagram.com/reel/…" /></Field>
            <Field label="Data de publicação"><input type="date" className="field num" value={f.published_at} onChange={set("published_at")} /></Field>
          </div>
          <Field label="Legenda original" hint="Quebras de linha e emojis são preservados exatamente."><textarea className="field" rows={4} value={f.caption} onChange={set("caption")} /></Field>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Métricas informadas manualmente <span className="font-normal text-ink-3">· opcional, ficam registradas com a data de hoje</span></legend>
            <div className="grid grid-cols-3 gap-3">
              {(["views", "likes", "comments"] as const).map((k) => (
                <input key={k} type="number" min={0} inputMode="numeric" className="field num" value={f[k]} onChange={set(k)} placeholder={{ views: "Visualizações", likes: "Curtidas", comments: "Comentários" }[k]} aria-label={{ views: "Visualizações", likes: "Curtidas", comments: "Comentários" }[k]} />
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Popover width={260} trigger={({ toggle }) => <Button type="button" size="sm" onClick={toggle}>Experts {sel.clients.length > 0 && <span className="num">{sel.clients.length}</span>}</Button>}>
              {() => <CheckList options={clients.map((c) => ({ value: c.id, label: c.name, color: c.color }))} value={sel.clients} onChange={(v) => setSel({ ...sel, clients: v })} empty="Nenhum expert cadastrado." />}
            </Popover>
            <Popover width={260} trigger={({ toggle }) => <Button type="button" size="sm" onClick={toggle}>Categorias {sel.categories.length > 0 && <span className="num">{sel.categories.length}</span>}</Button>}>
              {() => <CheckList options={categories.map((c) => ({ value: c.id, label: c.name }))} value={sel.categories} onChange={(v) => setSel({ ...sel, categories: v })} />}
            </Popover>
          </div>
          {progress != null && (
            <div className="flex items-center gap-3">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken"><span className="block h-full bg-ink transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} /></span>
              <span className="num text-[12px] text-ink-3">{progress < 1 ? `${Math.round(progress * 100)}%` : "processando…"}</span>
            </div>
          )}
          <div><Button type="submit" variant="primary" disabled={!file || progress != null}>Salvar na biblioteca</Button></div>
        </form>
      )}
    </section>
  );
}

// ---------- resultado por lote ----------

function JobCard({ job, defaultOpen }: { job: Job; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const count = (s: ImportItem["status"]) => job.items.filter((i) => i.status === s).length;
  const done = job.items.filter((i) => i.status !== "pendente" && i.status !== "baixando").length;
  const total = job.items.length;
  const live = done < total;

  return (
    <li className="overflow-hidden rounded-r3 border border-line bg-card">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full items-center gap-4 px-4 py-3 text-left hover:bg-sunken/60">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] font-medium">{job.source === "csv" ? "CSV" : job.source === "manual" ? "Upload manual" : "Links"}</span>
            <span className="num text-[12px] text-ink-3">{fmtDateTime(job.created_at)}</span>
          </div>
          <div className="num mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-2">
            <span>{done}/{total}</span>
            {count("ok") > 0 && <span className="text-ink">{count("ok")} importados</span>}
            {count("duplicado") > 0 && <span>{count("duplicado")} duplicados</span>}
            {count("erro") > 0 && <span className="inline-flex items-center gap-1 text-late"><AlertTriangle size={12} aria-hidden />{count("erro")} com erro</span>}
          </div>
        </div>
        <ChevronDown size={16} strokeWidth={1.5} className={cx("shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {live && (
        <div className="h-px bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Progresso do lote">
          <div className="h-px bg-ink transition-[width] duration-500" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {open && (
        <ul className="divide-y divide-line border-t border-line">
          {job.items.map((i) => <ItemRow key={i.id} item={i} />)}
        </ul>
      )}
    </li>
  );
}

const STATUS_ICON: Record<ImportItem["status"], ReactNode> = {
  pendente: <Clock size={12} aria-hidden />,
  baixando: <ArrowRight size={12} aria-hidden />,
  ok: <Check size={12} aria-hidden />,
  duplicado: <CopyCheck size={12} aria-hidden />,
  erro: <AlertTriangle size={12} aria-hidden />,
};

function ItemRow({ item }: { item: ImportItem }) {
  const tone: Record<ImportItem["status"], string> = {
    pendente: "text-ink-3", baixando: "text-ink", ok: "text-ink", duplicado: "text-ink-2", erro: "text-late",
  };
  const [noThumb, setNoThumb] = useState(false);
  return (
    <li className="flex gap-3 px-4 py-3">
      {item.ref_id && !noThumb ? (
        <button onClick={() => openRef(item.ref_id!)} className="h-[52px] w-[30px] shrink-0 overflow-hidden rounded-r1 bg-media-bg" aria-label={`Abrir ${item.ref_id}`}>
          <img src={media(`thumbnails/${item.ref_id}.jpg`)} alt="" loading="lazy" className="size-full object-cover" onError={() => setNoThumb(true)} />
        </button>
      ) : <span className="h-[52px] w-[30px] shrink-0 rounded-r1 border border-dashed border-line-2" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className={cx("num inline-flex w-[92px] shrink-0 items-center gap-1 text-[11px] tracking-wide uppercase", tone[item.status])}>{STATUS_ICON[item.status]}{STATUS_TXT[item.status]}</span>
          <span className="num min-w-0 truncate text-[12px] text-ink-2" title={item.url}>{item.url.replace(/^https?:\/\/(www\.)?/, "")}</span>
        </div>
        {item.status === "baixando" && <Working className="mt-2" />}
        {item.error && <p className={cx("mt-1 text-[13px] leading-snug", item.status === "erro" ? "text-ink" : "text-ink-2")}>{item.error}</p>}
        {item.ref_id && (
          <button onClick={() => openRef(item.ref_id!)} className="num mt-1 min-h-6 text-[12px] underline-offset-4 hover:underline">
            {item.status === "ok" ? "Conferir" : "Abrir"} {item.ref_id} →
          </button>
        )}
      </div>
    </li>
  );
}
