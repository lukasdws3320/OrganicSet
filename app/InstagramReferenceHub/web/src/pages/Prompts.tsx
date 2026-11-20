import { BookMarked, Check, Copy, Lightbulb, Search, Sparkles, Star, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { act, api, copy, toast, useApi } from "../lib";
import "../prompts.css";
import { Button, Chip, Empty, ErrorState, IconButton, Modal, PageHeader, Segmented, Skeleton, cx } from "../ui";

type Exemplo = { necessidade: string; entradas: string[]; trecho: string; resultado: string; atencao?: string };

type Item = {
  id: string;
  titulo: string;
  midia: "foto" | "video" | "receita";
  familia: string;
  objetivo: string;
  tipo: "prompt" | "template";
  status: string;
  motor: string;
  uso: string;
  notas: string[];
  blocos: string[];
  arquivo: string;
  exemplo: Exemplo | null;
  favorito: boolean;
  usos: number;
  ultimo_uso: string | null;
};

type Objetivo = { id: string; titulo: string; descricao: string; total: number };

const MIDIA_LABEL: Record<Item["midia"], string> = { foto: "Foto", video: "Vídeo", receita: "Receita" };


/** Mantém o texto curado legível: **negrito** vira <strong> e `código` vira <code>. */
function Rich({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {partes.map((t, i) => {
        if (t.startsWith("**") && t.endsWith("**"))
          return <strong key={i} className="font-medium text-ink">{t.slice(2, -2)}</strong>;
        if (t.startsWith("`") && t.endsWith("`"))
          return <code key={i} className="rounded bg-fg/8 px-1 py-px font-mono text-[11.5px] text-ink">{t.slice(1, -1)}</code>;
        return <span key={i}>{t}</span>;
      })}
    </>
  );
}

// Referência de imagem escrita no catálogo como link (ex.: http://127.0.0.1:4317/referencias/pixel-style-padrao.png).
const IMG = /(https?:\/\/[^\s]+?\.(?:png|jpe?g|webp|gif)|\/referencias\/[^\s]+?\.(?:png|jpe?g|webp|gif))/gi;
const caminhoLocal = (u: string) => u.replace(/^https?:\/\/(127\.0\.0\.1|localhost):\d+/, "");

async function copiarImagem(src: string) {
  try {
    const blob = await (await fetch(src)).blob();
    const png = blob.type === "image/png" ? blob : await new Promise<Blob>((ok, falha) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d")!.drawImage(img, 0, 0);
        c.toBlob((b) => (b ? ok(b) : falha(new Error("sem imagem"))), "image/png");
      };
      img.onerror = falha;
      img.src = URL.createObjectURL(blob);
    });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("Imagem copiada: cole no gerador");
  } catch {
    toast("Não deu para copiar a imagem. Arraste a miniatura para o gerador.", "erro");
  }
}

/** Miniatura da referência: arrastar para o gerador, copiar ou abrir em tamanho real. */
function Referencia({ src, tamanho = "sm" }: { src: string; tamanho?: "sm" | "md" }) {
  const local = caminhoLocal(src);
  const nome = local.split("/").pop();
  return (
    <span className={cx("pr-ref", tamanho === "md" && "pr-ref--md")}>
      <a href={local} target="_blank" rel="noreferrer" title={`Abrir ${nome}`} className="pr-ref-img">
        <img src={local} alt={`Referência ${nome}`} loading="lazy" />
      </a>
      <span className="pr-ref-acoes">
        <span className="num pr-ref-nome">{nome}</span>
        <button type="button" className="pr-ref-copiar" onClick={(e) => { e.stopPropagation(); copiarImagem(local); }}>
          <Copy size={12} strokeWidth={1.75} aria-hidden /> Copiar imagem
        </button>
      </span>
    </span>
  );
}

/** Texto curado com as referências de imagem mostradas como imagem, nunca como link cru. */
function ComImagens({ texto, tamanho }: { texto: string; tamanho?: "sm" | "md" }) {
  const partes = texto.split(IMG);
  if (partes.length === 1) return <Rich texto={texto} />;
  return (
    <>
      {partes.map((t, i) => (i % 2 ? <Referencia key={i} src={t} tamanho={tamanho} /> : t.trim() ? <Rich key={i} texto={t.replace(/:\s*$/, "")} /> : null))}
    </>
  );
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function Prompts() {
  const { data, error, reload } = useApi<any>("/api/prompts");
  const [q, setQ] = useState("");
  const [midia, setMidia] = useState<"todos" | Item["midia"]>("todos");
  const [objetivo, setObjetivo] = useState<string | null>(null);
  const [soFavoritos, setSoFavoritos] = useState(false);

  const itens: Item[] = data?.prompts ?? [];
  const objetivos: Objetivo[] = data?.objetivos ?? [];

  const filtrados = useMemo(() => {
    const busca = norm(q.trim());
    return itens.filter((p) => {
      if (midia !== "todos" && p.midia !== midia) return false;
      if (objetivo && p.objetivo !== objetivo) return false;
      if (soFavoritos && !p.favorito) return false;
      if (!busca) return true;
      const alvo = norm([p.id, p.titulo, p.uso, p.familia, p.exemplo?.necessidade ?? "", ...p.blocos].join(" "));
      return alvo.includes(busca);
    });
  }, [itens, q, midia, objetivo, soFavoritos]);

  const grupos = useMemo(
    () =>
      objetivos
        .map((o) => [o, filtrados.filter((p) => p.objetivo === o.id)] as const)
        .filter(([, lista]) => lista.length > 0),
    [objetivos, filtrados],
  );

  if (error && !data) return <div><PageHeader title={<>Prompts de <em>geração</em></>} /><ErrorState title="Não deu para ler o catálogo de prompts" detail={error} onRetry={reload} /></div>;

  return (
    <div>
      <PageHeader
        title={<>Prompts de <em>geração</em></>}
        meta={
          data
            ? `${data.total} prompts · ${objetivos.length} objetivos · ${data.favoritos} favoritos · catálogo de ${data.atualizado_em}`
            : "Carregando o catálogo…"
        }
        actions={
          <Button size="sm" variant={soFavoritos ? "primary" : "secondary"} aria-pressed={soFavoritos} onClick={() => setSoFavoritos((v) => !v)}
            icon={<Star size={14} strokeWidth={1.75} fill={soFavoritos ? "currentColor" : "none"} aria-hidden />}>
            Só favoritos
          </Button>
        }
      />

      {data?.aviso && (
        <div className="estado estado--div mb-6">
          <TriangleAlert aria-hidden />
          <div className="corpo"><b>Legado</b><p>{data.aviso}</p></div>
        </div>
      )}

      <div className="mb-7 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-[380px]">
            <Search size={15} strokeWidth={1.5} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
            <input
              className="field pl-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por tarefa, uso ou dentro do prompt"
              aria-label="Buscar prompt"
            />
          </div>
          <Segmented
            label="Mídia"
            size="sm"
            value={midia}
            onChange={(v) => setMidia(v)}
            options={[
              { value: "todos", label: "Todos" },
              { value: "foto", label: "Foto" },
              { value: "video", label: "Vídeo" },
              { value: "receita", label: "Receita" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!objetivo} onClick={() => setObjetivo(null)}>Tudo</Chip>
          {objetivos.map((o) => (
            <Chip key={o.id} active={objetivo === o.id} onClick={() => setObjetivo(objetivo === o.id ? null : o.id)}>
              {o.titulo} <span className="num text-[11px] opacity-70">{o.total}</span>
            </Chip>
          ))}
        </div>
      </div>

      {!data && <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} ratio="5/2" />)}</div>}

      {data && !filtrados.length && (
        <Empty
          title={<>Nada com esse <em>filtro</em></>}
          action={
            <Button onClick={() => { setQ(""); setMidia("todos"); setObjetivo(null); setSoFavoritos(false); }}>
              Limpar filtros
            </Button>
          }
        >
          Nenhum prompt combina com a busca atual. O catálogo tem {data.total} itens de foto, vídeo e receita.
        </Empty>
      )}

      <div className="flex flex-col gap-12">
        {grupos.map(([o, lista]) => (
          <section key={o.id}>
            <div className="mb-4 border-b border-line pb-3">
              <div className="sec-h mb-0! [&_h2]:text-[20px]">
                <h2>{o.titulo} <span className="mono ml-1 align-baseline font-[family-name:var(--f-mono)] text-[12px] text-ink-3">{lista.length}</span></h2>
              </div>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">{o.descricao}</p>
            </div>
            <ul className="grid gap-4 md:grid-cols-2">
              {lista.map((p) => (
                <li key={p.id} className="min-w-0 [&>article]:h-full">
                  <Cartao p={p} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Cartao({ p }: { p: Item }) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const codigo = p.blocos.join("\n\n---\n\n");

  const copiar = async () => {
    await copy(codigo, `${p.id} copiado`);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
    // Copiar já registra o uso: o acompanhamento não depende de disciplina manual.
    act(() => api(`/api/prompts/${p.id}/uso`, { method: "POST", json: {} }));
  };

  const favoritar = () => act(() => api(`/api/prompts/${p.id}/favorito`, { method: "POST", json: { favorito: !p.favorito } }));

  return (
    <article className="group flex h-full flex-col rounded-r3 border border-line bg-card p-4 transition-colors hover:border-line-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[11px] tracking-wide text-ink-3">{p.id}</span>
            <span className="font-mono text-[10px] tracking-wide text-ink-2 uppercase">{MIDIA_LABEL[p.midia]}</span>
            <span className="font-mono text-[10px] tracking-wide text-ink-3 uppercase">· {p.familia}</span>
            {p.tipo === "template" && (
              <span className="flex items-center gap-1 rounded-r1 border border-dashed border-line-2 px-1.5 py-px font-mono text-[10px] tracking-wide text-ink-2 uppercase">
                <BookMarked size={10} strokeWidth={2} aria-hidden /> molde
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-[16px] leading-snug font-medium tracking-[-0.01em]">{p.titulo}</h3>
        </div>
        <IconButton label={p.favorito ? "Remover dos favoritos" : "Favoritar"} active={p.favorito} onClick={favoritar}>
          <Star size={16} strokeWidth={1.5} fill={p.favorito ? "currentColor" : "none"} />
        </IconButton>
      </div>

      {p.uso && <div className="mt-2 text-[13px] leading-relaxed text-ink-2"><ComImagens texto={p.uso} /></div>}

      {p.exemplo && (
        <p className="mt-3 flex gap-2 rounded-r2 bg-sunken px-3 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <Lightbulb size={13} strokeWidth={1.6} className="mt-0.5 shrink-0 text-brasa-ink" aria-hidden />
          <span><span className="font-medium text-ink">Exemplo: </span><Rich texto={p.exemplo.necessidade} /></span>
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button
          size="sm"
          variant="primary"
          icon={copiado ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
          onClick={copiar}
        >
          {copiado ? "Copiado" : p.blocos.length > 1 ? `Copiar ${p.blocos.length} blocos` : "Copiar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAberto(true)}>
          Ver prompt{p.exemplo ? " e exemplo" : ""}
        </Button>
      </div>

      {aberto && (
        <Modal
          width={720}
          onClose={() => setAberto(false)}
          title={
            <span className="flex flex-col gap-1">
              <span className="num text-[11px] tracking-wide text-ink-3">
                {p.id} · {MIDIA_LABEL[p.midia]} · {p.familia} · {p.motor}
              </span>
              <span className="title-serif text-[24px] leading-tight">{p.titulo}</span>
            </span>
          }
        >
          <div className="flex flex-col gap-5">
            {p.uso && <div className="text-[13px] leading-relaxed text-ink-2"><ComImagens texto={p.uso} tamanho="md" /></div>}

            {p.exemplo && (
              <section className="rounded border border-line bg-sunken p-4">
                <h3 className="mb-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-brasa-ink uppercase">
                  <Lightbulb size={12} strokeWidth={2} aria-hidden /> exemplo de aplicação
                </h3>
                <p className="text-[13.5px] leading-relaxed text-ink"><Rich texto={p.exemplo.necessidade} /></p>

                <div className="mt-3">
                  <p className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">o que você anexa</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {p.exemplo.entradas.map((e, i) => (
                      <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
                        <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" aria-hidden />
                        <span className="min-w-0"><ComImagens texto={e} tamanho="md" /></span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">como fica o prompt</p>
                    <IconButton label="Copiar o exemplo preenchido" onClick={() => copy(p.exemplo!.trecho, "Exemplo copiado")}>
                      <Copy size={13} strokeWidth={1.5} />
                    </IconButton>
                  </div>
                  <pre className="grain mt-1 overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-[12px] leading-[1.65] whitespace-pre-wrap break-words">
                    {p.exemplo.trecho}
                  </pre>
                </div>

                <div className="mt-3">
                  <p className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">o que volta</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2"><Rich texto={p.exemplo.resultado} /></p>
                </div>

                {p.exemplo.atencao && (
                  <p className="mt-3 flex gap-2 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">
                    <TriangleAlert size={13} strokeWidth={1.6} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                    <span><Rich texto={p.exemplo.atencao} /></span>
                  </p>
                )}
              </section>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ink-3 uppercase">
                <Sparkles size={12} strokeWidth={2} /> prompt original do acervo
              </h3>
              <div className="flex flex-col gap-2">
                {p.blocos.map((b, i) => (
                  <div key={i} className="relative">
                    {p.blocos.length > 1 && (
                      <span className="num mb-1 block text-[11px] text-ink-3">bloco {i + 1}/{p.blocos.length}</span>
                    )}
                    <pre className="grain overflow-x-auto rounded border border-line bg-paper p-3 pr-12 font-mono text-[12px] leading-[1.65] whitespace-pre-wrap break-words">
                      {b}
                    </pre>
                    <IconButton label={`Copiar bloco ${i + 1}`} onClick={() => copy(b, `Bloco ${i + 1} copiado`)} className="absolute top-1 right-1">
                      <Copy size={13} strokeWidth={1.5} />
                    </IconButton>
                  </div>
                ))}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Button
                variant="primary"
                icon={copiado ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
                onClick={copiar}
              >
                {copiado ? "Copiado" : p.blocos.length > 1 ? `Copiar os ${p.blocos.length} blocos` : "Copiar prompt"}
              </Button>
              <Button
                variant="ghost"
                onClick={favoritar}
                icon={<Star size={14} strokeWidth={1.5} fill={p.favorito ? "currentColor" : "none"} />}
              >
                {p.favorito ? "Nos favoritos" : "Favoritar"}
              </Button>
              <span className={cx("num ml-auto text-[11px] text-ink-3")}>{p.arquivo.split("/").pop()}</span>
            </div>
          </div>
        </Modal>
      )}
    </article>
  );
}
