import { Download, FolderOpen, Save } from "lucide-react";
import { useState, type ReactNode } from "react";
import { act, api, fmtBytes, fmtDateTime, useApi } from "../lib";
import { Button, ButtonLink, ErrorState, Field, Modal, PageHeader, Skeleton } from "../ui";

const BROWSERS = [
  { value: "", label: "Desligado" },
  { value: "chrome", label: "Chrome" },
  { value: "safari", label: "Safari" },
  { value: "firefox", label: "Firefox" },
  { value: "brave", label: "Brave" },
  { value: "edge", label: "Edge" },
  { value: "arc", label: "Arc" },
];

type SettingsData = {
  cookies_browser: string;
  import_delay_ms: string;
  meta_posts_dia: string;
  agenda_perfis?: string;
  horarios_posts: string;
  agenda_auto: string;
  library: string;
};

type Storage = {
  root: string;
  parts: Record<string, number>;
  total: number;
  free: number | null;
};

type Backup = { name: string; size: number; created_at: string };

const PARTS: [string, string][] = [
  ["videos", "Vídeos"],
  ["thumbnails", "Capas"],
  ["database", "Banco"],
  ["exports", "Exportações"],
  ["backups", "Backups"],
];

/** Título de seção padrão do Hub (`.sec-h`, serif 20). */
function Sec({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="sec-h [&_h2]:text-[20px]">
        <h2>{title}</h2>
        {action && <span className="sp">{action}</span>}
      </div>
      {children}
    </section>
  );
}

const Esq = () => <div className="flex flex-col gap-2"><Skeleton ratio="10/1" /><Skeleton ratio="10/1" /></div>;

export function Settings() {
  const settings = useApi<SettingsData>("/api/settings");
  const disk = useApi<Storage>("/api/storage");
  const backups = useApi<Backup[]>("/api/backups");
  const [delay, setDelay] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restaurar, setRestaurar] = useState<string | null>(null);

  const s = settings.data;
  // Guardado em ms no servidor; aqui se lê e escreve em segundos ("2,5").
  const emSegundos = (ms: string) => String(Number(ms) / 1000).replace(".", ",");
  const emMs = (seg: string) => String(Math.round(Math.min(120, Math.max(0, Number(seg.replace(",", ".")) || 0)) * 1000));
  const delayValue = delay ?? emSegundos(s?.import_delay_ms ?? "4000");

  async function save(patch: Partial<SettingsData>) {
    const next = await act(() => api<SettingsData>("/api/settings", { method: "PATCH", json: patch }), "Configuração salva");
    if (next && patch.import_delay_ms !== undefined) setDelay(null);
    if (next && patch.horarios_posts !== undefined) setHorarios(null);
  }

  async function backup() {
    setBusy(true);
    const made = await act(() => api<Backup>("/api/backup", { method: "POST" }), "Backup criado");
    setBusy(false);
    if (made) backups.reload();
  }

  async function restore(name: string) {
    setBusy(true);
    const ok = await act(() => api("/api/restore?name=" + encodeURIComponent(name), { method: "POST" }), "Biblioteca restaurada");
    setBusy(false);
    setRestaurar(null);
    if (ok) location.reload();
  }

  return (
    <div className="max-w-[760px]">
      <PageHeader
        title={<>Configurações da <em>biblioteca</em></>}
        meta="Tudo fica neste Mac. O Instagram só é consultado na importação."
      />

      {!s && !settings.error && <Esq />}
      {settings.error && !s && <ErrorState title="Não deu para ler as configurações" detail={settings.error} onRetry={settings.reload} />}
      {s && (
        <div className="flex flex-col gap-12">
          <Sec title={<>Onde os arquivos <em>estão</em></>}>
            <p className="num break-all text-[13px] text-ink">{s.library}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button icon={<FolderOpen size={16} strokeWidth={1.75} />} onClick={() => act(() => api("/api/library/reveal", { method: "POST" }))}>
                Abrir no Finder
              </Button>
            </div>
          </Sec>

          <Sec title="Importação">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sessão do navegador" hint="Desligado, o Hub baixa sem login e só usa a sessão do Chrome quando o Instagram exigir. Ligado, usa sempre.">
                <select
                  className="field"
                  value={s.cookies_browser}
                  onChange={(e) => save({ cookies_browser: e.target.value })}
                >
                  {BROWSERS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </Field>
              <Field label="Intervalo entre links" hint="De 0 a 120 segundos. O Instagram limita taxa.">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      className="field num pr-16"
                      inputMode="decimal"
                      value={delayValue}
                      onChange={(e) => setDelay(e.target.value.replace(/[^\d,.]/g, ""))}
                      onKeyDown={(e) => { if (e.key === "Enter" && delay !== null) save({ import_delay_ms: emMs(delayValue) }); }}
                      aria-label="Intervalo entre links em segundos"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-ink-3">segundos</span>
                  </div>
                  <Button
                    disabled={delay === null || emMs(delay) === s.import_delay_ms}
                    icon={<Save size={16} strokeWidth={1.75} />}
                    onClick={() => save({ import_delay_ms: emMs(delayValue) })}
                  >
                    Salvar
                  </Button>
                </div>
              </Field>
            </div>
          </Sec>

          <Sec title="Agenda de posts">
            {s.agenda_perfis && s.agenda_perfis !== "{}" && <p className="text-sm text-muted mb-4">{Object.entries(JSON.parse(s.agenda_perfis) as Record<string, {meta:number;horariosIA?:string[]}>).map(([slug,c]) => `${slug}: ${c.meta} posts/dia${c.horariosIA ? ` · ${c.horariosIA.length} IA + ${c.meta-c.horariosIA.length} repostagens` : ""}`).join(" · ")}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Meta padrão por dia" hint="Posts por dia nos perfis sem regra própria. Post pronto entra no próximo horário livre; dia cheio passa para o seguinte.">
                <select className="field" value={s.meta_posts_dia} onChange={(e) => save({ meta_posts_dia: e.target.value })}>
                  {Array.from({ length: 8 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n} {n === "1" ? "post" : "posts"} por dia</option>)}
                </select>
              </Field>
              <Field label="Agenda automática" hint="Ligada, o Hub agenda sozinho o que fica pronto e remarca o que venceu sem ser postado.">
                <select className="field" value={s.agenda_auto} onChange={(e) => save({ agenda_auto: e.target.value })}>
                  <option value="1">Ligada</option>
                  <option value="0">Desligada</option>
                </select>
              </Field>
              <Field label="Horários" hint="Separados por vírgula. Entre dois posts do mesmo perfil fica pelo menos 1 hora.">
                <div className="flex gap-2">
                  <input className="field num flex-1" value={horarios ?? s.horarios_posts.replace(/,/g, ", ")} onChange={(e) => setHorarios(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && horarios !== null) save({ horarios_posts: horarios }); }} aria-label="Horários dos posts" />
                  <Button disabled={horarios === null} icon={<Save size={16} strokeWidth={1.75} />} onClick={() => save({ horarios_posts: horarios! })}>Salvar</Button>
                </div>
              </Field>
            </div>
          </Sec>

          <Sec title="Espaço">
            {!disk.data && (disk.error ? <ErrorState title="Espaço indisponível" detail={disk.error} onRetry={disk.reload} /> : <Esq />)}
            {disk.data && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {PARTS.map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-[12px] text-ink-3">{label}</dt>
                    <dd className="num text-[15px]">{fmtBytes(disk.data!.parts[key] ?? 0)}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-[12px] text-ink-3">Total</dt>
                  <dd className="num text-[15px]">{fmtBytes(disk.data.total)}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-ink-3">Livre no disco</dt>
                  <dd className="num text-[15px]">{disk.data.free == null ? "Não disponível" : fmtBytes(disk.data.free)}</dd>
                </div>
              </dl>
            )}
          </Sec>

          <Sec title="Backup" action={<Button variant="primary" busy={busy} busyLabel="Criando…" onClick={backup}>Criar backup</Button>}>
            {!backups.data && (backups.error ? <ErrorState title="Backups indisponíveis" detail={backups.error} onRetry={backups.reload} /> : <Esq />)}
            {backups.data && !backups.data.length && <p className="text-[13px] text-ink-2">Nenhum backup ainda. Crie um antes de mudanças grandes na biblioteca.</p>}
            {backups.data && backups.data.length > 0 && (
              <ul className="divide-y divide-line border-y border-line">
                {backups.data.map((b) => (
                  <li key={b.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="num truncate text-[13px]">{b.name}</p>
                      <p className="num text-[12px] text-ink-3">{fmtBytes(b.size)} · {fmtDateTime(b.created_at)}</p>
                    </div>
                    <div className="flex gap-2">
                      <ButtonLink size="sm" icon={<Download size={14} strokeWidth={1.75} aria-hidden />} href={`/api/backups/${encodeURIComponent(b.name)}`} download aria-label={`Baixar ${b.name}`}>Baixar</ButtonLink>
                      <Button size="sm" variant="danger" disabledReason={busy ? "Aguarde a operação em andamento" : undefined} onClick={() => setRestaurar(b.name)}>Restaurar</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[12px] text-ink-3">Restaurar não apaga a biblioteca atual: ela vai para uma pasta “antes-da-restauracao”.</p>
          </Sec>
        </div>
      )}
      {restaurar && (
        <Modal
          title={<>Restaurar <em>backup</em>?</>}
          onClose={() => !busy && setRestaurar(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setRestaurar(null)} disabledReason={busy ? "Restaurando" : undefined}>Cancelar</Button>
            <Button variant="primary" busy={busy} busyLabel="Restaurando…" onClick={() => restore(restaurar)}>Restaurar</Button>
          </>}
        >
          <p className="text-[14px] text-ink-2">
            A biblioteca volta para <span className="num text-ink">{restaurar}</span>. A versão atual é guardada em
            <span className="num"> backups/antes-da-restauracao</span>, não apagada. O Hub recarrega ao terminar.
          </p>
        </Modal>
      )}
    </div>
  );
}
