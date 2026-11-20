import { useRef, useState } from "react";
import { act, api, markPosted, navigate, scheduleItem, toast, unmarkPosted, useApi } from "./lib";
import { Button, Field, Modal, Segmented } from "./ui";
import { FORMAT_OPTIONS } from "../../server/replication-formats";
import { estudioHref } from "./replication-experts";

export function NovaReplicacao({ onClose, refInicial, expertInicial, stayOnPage = false }: { onClose: () => void; refInicial?: string; expertInicial?: string; stayOnPage?: boolean }) {
  const refs = useApi<any>("/api/refs").data;
  const experts = useApi<any[]>("/api/clients").data?.filter(e => e.ativo !== false) ?? [];
  const lista: any[] = Array.isArray(refs) ? refs : refs?.items ?? [];
  const [v, setV] = useState({ ref: refInicial ?? "", expert_id: expertInicial ?? "", formato: "", engine: "Veo 3" });
  const [busy, setBusy] = useState(false);
  const originScroll = useRef({ left: window.scrollX, top: window.scrollY });
  const finish = (id: string) => {
    onClose();
    if (stayOnPage) requestAnimationFrame(() => window.scrollTo({ ...originScroll.current, behavior: "instant" }));
    else navigate(estudioHref(id));
  };
  const ex = experts.find((e) => String(e.id) === v.expert_id);
  const { data: current } = useApi<any>(v.ref ? `/api/replicacoes/${v.ref}` : null);
  const existing = current?.ref === v.ref ? current.outras?.find((r: any) => r.expert === ex?.name) : null;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const r = await act(() => api<any>("/api/replicacoes", {
      method: "POST", json: { ...v, expert_id: v.expert_id ? Number(v.expert_id) : undefined },
    }));
    setBusy(false);
    if (r) {
      toast(r.existente ? "Esta replicação já existe" : r.preparacao?.status === "aguardando_conferencia" ? "Pedido salvo; a análise aguarda conferência em Produção" : "Pedido salvo. A preparação continua em segundo plano; acompanhe em Produção.");
      finish(r.id);
    }
  };
  const semSheet = !!ex && !ex.avatar;
  return (
    <Modal title={<>Nova <em>replicação</em></>} onClose={onClose} width={520}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="nova-replicacao" variant="primary" busy={busy} busyLabel="Salvando pedido…"
          disabledReason={!v.ref ? "Escolha uma referência" : semSheet ? "Cadastre a contact sheet do expert antes" : undefined}>
          {existing ? stayOnPage ? "Concluir" : "Abrir replicação" : v.expert_id ? "Criar" : "Segmentar"}
        </Button>
      </>}>
      <form id="nova-replicacao" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (v.ref && !semSheet) submit(); }}>
        <Field label="Referência">
          <select required className="field" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })}>
            <option value="">Escolha…</option>
            {refInicial && !lista.some(r => r.id === refInicial) && <option value={refInicial}>{refInicial}</option>}
            {lista.filter((r) => r.kind === "video" || !r.kind).map((r) => <option key={r.id} value={r.id}>{r.id} · @{r.username ?? "?"}</option>)}
          </select>
        </Field>
        <Field label="Expert" hint={ex?.avatar ? <span className="num">Avatar: @{ex.avatar} · {ex.avatar_estilo === "real" ? "pessoa real" : "personagem 3D"} · voz conforme contexto da personagem</span> : undefined}>
          <select aria-label="Expert da replicação" className="field" value={v.expert_id} onChange={(e) => setV({ ...v, expert_id: e.target.value })}>
            <option value="">Só segmentar por enquanto</option>
            {experts.map((e) => <option key={e.id} value={e.id}>{e.name}{e.avatar ? "" : " (sem contact sheet)"}</option>)}
          </select>
        </Field>
        {semSheet && <p role="alert" className="text-[12px] text-late">Cadastre a contact sheet desse expert em Experts antes (ex.: contactsheet{ex.name.replace(/\s+/g, "")}01).</p>}
        <div className="flex flex-col gap-1.5 text-[13px]"><span className="font-medium">Formato</span>
          <select aria-label="Formato" className="field w-full" value={v.formato} onChange={e => setV({ ...v, formato: e.target.value })}>
            <option value="">Usar formato da referência</option>
            {FORMAT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <Field label="Modelo de vídeo"><select className="field" value={v.engine} onChange={e => setV({ ...v, engine: e.target.value })}><option>Veo 3</option><option>Seedance 2.0</option></select></Field>
      </form>
    </Modal>
  );
}

// ---------- data/hora real (input datetime-local ↔ ISO) ----------

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → "AAAA-MM-DDTHH:mm" no fuso local (valor de <input type="datetime-local">). */
export function toLocalInput(iso?: string | null, base = new Date()) {
  const d = iso ? new Date(iso) : base;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const isPostUrl = (u: string) => /^(https?:\/\/)?\S+\.\S+\/\S/.test(u.trim());

/**
 * Link e data são opcionais. A marcação é registrada independentemente da consulta.
 * Só envia a data se editada; assim a data obtida do link não vira manual silenciosamente.
 */
export function MarcarPostadoModal({ id, titulo, url: url0, postadoEm, corrigir = false, post, onClose }: {
  id: string; titulo?: string; url?: string | null; postadoEm?: string | null; corrigir?: boolean; post?: string; onClose: () => void;
}) {
  const [url, setUrl] = useState(url0 ?? "");
  const [quando, setQuando] = useState(postadoEm ? toLocalInput(postadoEm) : "");
  const [dateChanged, setDateChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const iso = fromLocalInput(quando);
  const futuro = !!iso && new Date(iso).getTime() > Date.now() + 5 * 60_000;
  const motivo = url.trim() && !isPostUrl(url) ? "Confira o link do post" : quando && !iso ? "Confira a data e a hora" : futuro ? "A data do post está no futuro; para isso use Agendar" : undefined;
  const salvar = async () => {
    if (motivo) return;
    setBusy(true);
    const ok = await act(() => markPosted(id, url.trim(), dateChanged ? iso : undefined, post), corrigir ? "Publicação atualizada" : "Marcado como postado", corrigir ? undefined : () => unmarkPosted(id, post));
    setBusy(false);
    if (ok) {
      onClose();
      if (url.trim()) void act(() => api(`/api/replicacoes/${encodeURIComponent(id)}/publicacao/atualizar${post ? `?post=${encodeURIComponent(post)}` : ""}`, { method: "POST" }), "Dados do post atualizados");
    }
  };
  return (
    <Modal title={corrigir ? <>Editar <em>publicação</em></> : <>Marcar como <em>postado</em></>} onClose={onClose} width={500}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="marcar-postado" variant="primary" busy={busy} disabledReason={motivo}>{corrigir ? "Salvar" : "Marcar como postado"}</Button>
      </>}>
      <form id="marcar-postado" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        {titulo && <p className="num text-[12px] text-ink-3">{titulo}</p>}
        <Field label="Link do post (opcional)" hint="Com um link, buscamos os dados disponíveis do post. Você pode anexá-lo depois.">
            <input autoFocus type="url" inputMode="url" className="field" placeholder="https://www.instagram.com/reel/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
        <Field label="Data e hora do post (opcional)" hint="Pode deixar em branco. Buscamos a data pelo link quando a plataforma a disponibiliza; a hora da marcação é registrada separadamente.">
          <input type="datetime-local" className="field num" value={quando} max={toLocalInput(null, new Date(Date.now() + 5 * 60_000))} onChange={(e) => { setQuando(e.target.value); setDateChanged(true); }} />
        </Field>
        {motivo && (url || corrigir) && <p className="text-[12px] text-ink-3">{motivo}.</p>}
      </form>
    </Modal>
  );
}

/** Agendar (ou reagendar) um item pronto: PATCH /api/pipeline/:id {agendado_para}. */
export function AgendarModal({ id, titulo, agendadoPara, post, onClose }: { id: string; titulo?: string; agendadoPara?: string | null; post?: string; onClose: () => void }) {
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1); amanha.setHours(17, 30, 0, 0);
  const [quando, setQuando] = useState(toLocalInput(agendadoPara, amanha));
  const [busy, setBusy] = useState(false);
  const iso = fromLocalInput(quando);
  const salvar = async () => {
    if (!iso) return;
    setBusy(true);
    const ok = await act(() => scheduleItem(id, iso, post), agendadoPara ? "Agendamento atualizado" : "Agendado", () => scheduleItem(id, agendadoPara ?? null, post));
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title={agendadoPara ? <>Reagendar <em>post</em></> : <>Agendar <em>post</em></>} onClose={onClose} width={460}
      footer={<>
        {agendadoPara && <Button variant="danger" className="mr-auto" onClick={async () => { if (await act(() => scheduleItem(id, null), "Agendamento removido", () => scheduleItem(id, agendadoPara))) onClose(); }}>Remover agendamento</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="agendar-post" variant="primary" busy={busy} disabledReason={!iso ? "Informe a data e a hora" : undefined}>Agendar</Button>
      </>}>
      <form id="agendar-post" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
        {titulo && <p className="num text-[12px] text-ink-3">{titulo}</p>}
        <Field label="Data e hora previstas" hint="Aparece no calendário da Produção e no painel do expert.">
          <input autoFocus required type="datetime-local" className="field num" value={quando} onChange={(e) => setQuando(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
