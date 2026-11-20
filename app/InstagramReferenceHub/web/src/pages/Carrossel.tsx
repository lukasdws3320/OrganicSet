import { Copy, Download, ExternalLink, FolderOpen } from "lucide-react";
import { api, fmtInt, navigate, toast, useApi } from "../lib";
import { producaoHref } from "../replication-experts";
import { Button, ButtonLink, Empty, ErrorState, PageHeader, Skeleton } from "../ui";
import { StageBadge } from "../components/StageBadge";
import type { Stage } from "../../../server/types";
import "../carrossel.css";

export type EtapaCarrossel = "prompts" | "gerando" | "pronto" | "postado";
export type CarrosselApi = {
  id: string; perfil: { slug: string; name: string }; personagem: string | null; lote: string; post: string; titulo: string; rel: string;
  etapa: EtapaCarrossel; quantidade: number; prontos: number; geracoes: number; reprovadas: number;
  slides: { n: number; original: string | null; replicado: string | null }[]; capa: string | null; legenda: string; zip: string | null;
  arquivado?: boolean; stage?: Stage; agendado_para?: string | null; late?: boolean; data: string | null; publicacao: string | null; url: string | null;
};

/** Carrossel no quadro de produção: Prompts/Gerando = Em produção, Pronto = Pronta, Postado = Postada. Sem etapa de edição. */
export const stageCarrossel = (c: CarrosselApi): Stage => c.stage ?? (c.etapa === "postado" ? "postada" : c.etapa === "pronto" ? "pronta" : "producao");
export const subCarrossel = (c: CarrosselApi) =>
  c.etapa === "prompts" ? `Só originais · ${c.quantidade} slides` : c.etapa === "gerando" ? `Gerando · ${c.prontos}/${c.quantidade} slides` : `${c.quantidade} slides`;
export const dataCurta = (d: string | null) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : null;

const ETAPA_LABEL: Record<EtapaCarrossel, string> = { prompts: "Só originais", gerando: "Gerando imagens", pronto: "Pronto", postado: "Postado" };

export function CarrosselPage({ id }: { id: string }) {
  const { data: c, error, reload } = useApi<CarrosselApi>(`/api/carrosseis/${id}`);
  if (error && !c) return <ErrorState title="Não foi possível abrir o carrossel" detail={error} onRetry={reload} />;
  if (!c) return <div className="car-skel" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} ratio="3/4" />)}</div>;
  const copiar = async () => { try { await navigator.clipboard.writeText(c.legenda); toast("Legenda copiada"); } catch { toast("Não deu para copiar", "erro"); } };
  const abrir = async () => { await api(`/api/carrosseis/${c.id}/abrir`, { method: "POST" }); toast("Pasta aberta no Finder"); };
  const voltar = producaoHref(c.perfil.slug);
  return (
    <div className="car">
      <PageHeader
        title={<>{c.titulo} <em>· carrossel</em></>}
        meta={<>
          <a href={voltar} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(voltar); }}>{c.perfil.name}</a>
          {c.personagem && <> · {c.personagem}</>} · {c.post} · <span className="num">{fmtInt(c.prontos)}/{fmtInt(c.quantidade)}</span> slides replicados
          {c.reprovadas > 0 && <> · {c.reprovadas} reprovada{c.reprovadas > 1 ? "s" : ""}</>}
          {dataCurta(c.data) && <> · data {dataCurta(c.data)}</>}
        </>}
        actions={<>
          {c.url && <ButtonLink variant="ghost" href={c.url} external icon={<ExternalLink size={16} />}>Ver post</ButtonLink>}
          <Button variant="ghost" icon={<FolderOpen size={16} />} onClick={abrir}>Abrir pasta</Button>
          {c.zip && <ButtonLink variant="primary" href={c.zip} download icon={<Download size={16} />}>Baixar .zip</ButtonLink>}
        </>}
      >
        <div className="car-status">
          <StageBadge stage={stageCarrossel(c)} label={c.arquivado ? "Arquivado" : c.stage === "agendada" ? "Agendado" : ETAPA_LABEL[c.etapa]} />
          <span className="car-fluxo">Original → imagem replicada (GPT) → pronto → postado. Carrossel não tem edição: a imagem replicada já é a peça final.</span>
        </div>
      </PageHeader>

      {!c.slides.length ? <Empty title={<>Sem slides <em>ainda</em></>}>Coloque as imagens da referência em <code>originais/</code> e as replicadas em <code>imagens/</code> (01.png, 02.png…).</Empty> : (
        <ol className="car-grid">
          {c.slides.map((s) => (
            <li key={s.n} className="car-slide">
              <span className="car-n num">{String(s.n).padStart(2, "0")}</span>
              <figure className="car-par">
                <div className="car-img">{s.original ? <img src={s.original} alt={`Original ${s.n}`} loading="lazy" /> : <span className="car-falta">sem original</span>}<figcaption>Referência</figcaption></div>
                <div className="car-img">{s.replicado ? <img src={s.replicado} alt={`Replicado ${s.n}`} loading="lazy" /> : <span className="car-falta">falta replicar</span>}<figcaption>Replicado</figcaption></div>
              </figure>
            </li>
          ))}
        </ol>
      )}

      <section className="car-leg" aria-label="Legenda do post">
        <header><h2>Legenda</h2>{c.legenda && <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={copiar}>Copiar</Button>}</header>
        {c.legenda ? <pre>{c.legenda}</pre> : <p className="text-ink-3">Sem <code>legendas.md</code> na pasta do post.</p>}
      </section>
      <p className="car-pasta num">{c.rel}</p>
    </div>
  );
}
