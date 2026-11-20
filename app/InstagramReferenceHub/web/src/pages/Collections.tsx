import { ArrowLeft, Download, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Filters } from "../../../server/types";
import { STAGE_LABEL } from "../../../server/types";
import { act, api, media, navigate, plural, toast, useApi, useBgLocation } from "../lib";
import { Button, Empty, ErrorState, Field, Modal, MoreMenu, Skeleton } from "../ui";
import { bibHref, Biblioteca } from "./Library";

type Quadro = { id: number; name: string; description: string | null; kind: "manual" | "smart"; filters: Filters | null; ref_count: number; covers: string[] };

/** Coleções "@perfil" viraram o filtro Criador: ficam ocultas (não apagadas) da lista de quadros. */
export const isColecaoDeCriador = (c: { name: string }) => String(c.name).startsWith("@");

/** Aba Quadros: curadoria temática (coleções que não são "@perfil"). */
export function QuadrosLista() {
  const { data, error, reload } = useApi<Quadro[]>("/api/collections");
  const loc = useBgLocation();
  const [creating, setCreating] = useState(false);
  const quadros = data?.filter((c) => !isColecaoDeCriador(c)) ?? null;
  const ocultas = data ? data.length - (quadros?.length ?? 0) : 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[620px] text-[13px] text-ink-2">
          Quadros agrupam referências por tema ou campanha. Uma referência pode estar em vários.
          {ocultas > 0 && <span className="text-ink-3"> {plural(ocultas, "coleção “@perfil” virou", "coleções “@perfil” viraram").replace(" ", "\u00a0")} o filtro Criador.</span>}
        </p>
        <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setCreating(true)}>Novo quadro</Button>
      </div>
      {error && !data && <ErrorState title="Não deu para carregar os quadros" detail={error} onRetry={reload} />}
      {!data && !error && <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} ratio="16/9" />)}</div>}
      {quadros && !quadros.length && (
        <Empty title={<>Nenhum quadro <em>ainda</em></>} action={<Button variant="primary" onClick={() => setCreating(true)}>Criar quadro</Button>}>
          Selecione referências na grade e use “Quadro” na barra de lote, ou crie um quadro vazio aqui.
        </Empty>
      )}
      {quadros && quadros.length > 0 && (
        <ul className="grid min-w-0 gap-x-6 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          {quadros.map((c) => {
            const href = bibHref(loc.path, "quadros", { quadro: c.id });
            return (
              <li key={c.id} className="min-w-0">
                <a href={href} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(href); }} className="group block min-w-0">
                  <div className="grid grid-cols-4 gap-1 overflow-hidden rounded-r3">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="img-outline aspect-[9/16] min-w-0 overflow-hidden rounded-r1 bg-media-bg">
                        {c.covers[i] && <img src={media(c.covers[i])} alt="" loading="lazy" className="size-full object-cover transition-[scale] duration-500 group-hover:scale-[1.03]" />}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <h2 className="min-w-0 truncate text-[16px] font-medium group-hover:underline group-hover:underline-offset-4">{c.name}</h2>
                    <span className="num shrink-0 text-[12px] text-ink-3">{c.ref_count}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink-2">
                    {c.kind === "smart" ? <><span className="text-brasa-ink">Inteligente</span> · {describe(c.filters)}</> : c.description || "Manual"}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {creating && <CollectionForm onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Cabeçalho do quadro aberto: voltar, exportar, renomear, excluir (Modal, nada de confirm()). */
export function QuadroCabecalho({ id }: { id: number }) {
  const { data: c, error } = useApi<Quadro>(`/api/collections/${id}`);
  const loc = useBgLocation();
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);
  const voltar = bibHref(loc.path, "quadros");

  const exportZip = () => {
    setExporting(true);
    toast("Gerando o zip com vídeos e metadados. O download começa quando ficar pronto.");
    window.location.href = `/api/collections/${id}/export`;
    setTimeout(() => setExporting(false), 4000);
  };

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <a href={voltar} onClick={(e) => { e.preventDefault(); navigate(voltar); }} className="btn btn--ghost btn--sm"><ArrowLeft size={14} /> Quadros</a>
        {error && <span className="text-[13px] text-late">{error}</span>}
        {c && (
          <>
            <span className="min-w-0 truncate text-[13px] text-ink-2">
              {c.kind === "smart" ? <span className="text-brasa-ink">Inteligente · {describe(c.filters)}</span> : c.description}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="secondary" icon={<Download size={14} strokeWidth={1.5} />} busy={exporting} busyLabel="Gerando zip…" onClick={exportZip}>Exportar com arquivos</Button>
              {c.kind === "smart" && <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={14} strokeWidth={1.5} />} onClick={() => navigate(bibHref(loc.path, "todas", { f: JSON.stringify(c.filters ?? {}) }))}>Abrir filtro</Button>}
              <MoreMenu label="Mais ações do quadro" items={[
                { label: <span className="inline-flex items-center gap-2"><Pencil size={14} /> Renomear</span>, onSelect: () => setEdit(true) },
                { label: <span className="inline-flex items-center gap-2"><Trash2 size={14} /> Excluir quadro</span>, onSelect: () => setConfirm(true), danger: true },
              ]} />
            </span>
          </>
        )}
      </div>
      {edit && c && <CollectionForm collection={c} onClose={() => setEdit(false)} />}
      {confirm && (
        <Modal title={<>Excluir <em>quadro</em>?</>} onClose={() => setConfirm(false)} footer={<>
          <Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
          <Button variant="danger" icon={<Trash2 size={16} strokeWidth={1.5} />} onClick={async () => {
            if (await act(() => api(`/api/collections/${id}`, { method: "DELETE" }), "Quadro excluído")) navigate(voltar);
          }}>Excluir quadro</Button>
        </>}>
          <p className="text-[14px] text-ink-2">Só o quadro é excluído. As referências e os vídeos continuam na biblioteca.</p>
        </Modal>
      )}
    </div>
  );
}

/** Resumo legível de um filtro salvo. */
export function describe(f: Filters | null) {
  if (!f) return "sem filtro";
  const parts: string[] = [];
  if (f.q) parts.push(`busca “${f.q}”`);
  if (f.clients?.length) parts.push(plural(f.clients.length, "expert", "experts"));
  if (f.profile) parts.push(`expert ${f.profile}`);
  if (f.categories?.length) parts.push(plural(f.categories.length, "categoria", "categorias"));
  if (f.facets) for (const [k, v] of Object.entries(f.facets)) if (v.length) parts.push(`${k} (${v.length})`);
  if (f.stage?.length) parts.push(f.stage.map((s) => STAGE_LABEL[s]).join(" ou "));
  if (f.creator) parts.push(`@${f.creator}`);
  if (f.cta) parts.push(`CTA “${f.cta}”`);
  if (f.favorite) parts.push("favoritas");
  if (f.minLikes != null) parts.push(`≥ ${f.minLikes} curtidas`);
  if (f.minViews != null) parts.push(`≥ ${f.minViews} views`);
  if (f.minComments != null) parts.push(`≥ ${f.minComments} comentários`);
  if (f.publishedFrom || f.publishedTo || f.importedFrom || f.importedTo) parts.push("período");
  return parts.join(", ") || "todas as referências";
}

function CollectionForm({ collection, onClose }: { collection?: Quadro; onClose: () => void }) {
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [busy, setBusy] = useState(false);
  const loc = useBgLocation();
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await act(
      () => api<{ id: number }>(collection ? `/api/collections/${collection.id}` : "/api/collections", { method: collection ? "PATCH" : "POST", json: { name: name.trim(), description } }),
      collection ? "Quadro atualizado" : "Quadro criado",
    );
    setBusy(false);
    if (r) { onClose(); if (!collection) navigate(bibHref(loc.path, "quadros", { quadro: r.id })); }
  };
  return (
    <Modal title={collection ? <>Renomear <em>quadro</em></> : <>Novo <em>quadro</em></>} onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancelar</Button>
      <Button variant="primary" busy={busy} onClick={submit} disabledReason={name.trim() ? undefined : "Dê um nome ao quadro"}>{collection ? "Salvar" : "Criar quadro"}</Button>
    </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Nome"><input autoFocus className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Receitas fit — ganchos visuais" /></Field>
        <Field label="Descrição" hint="Opcional. Para que serve este quadro."><textarea className="field" rows={2} value={description ?? ""} onChange={(e) => setDescription(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

// ---------- exports antigos (App.tsx atual): renderizam a aba Quadros nova ----------

export function Collections() {
  return <Biblioteca aba="quadros" />;
}

export function CollectionPage({ id }: { id: number }) {
  return <Biblioteca aba="quadros" quadro={id} />;
}
