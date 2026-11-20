import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, ArrowLeft, CalendarClock, Plus, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FolderOpen, Film, Image as ImageIcon, Info, Maximize2, Play, Send, RefreshCw } from "lucide-react";
import { act, api, archiveItem, arquivar, arquivarPost, copy, fmtDateTime, media, navigate, novoPost, openRef, patchPost, unmarkPosted, useApi, useLocation } from "../lib";
import type { PostItem } from "../../../server/posts";
import { postCard } from "../posts-card";
import { Button, ButtonLink, cx, Modal, MoreMenu } from "../ui";
import { StageBadge } from "../components/StageBadge";
import {ProductionExecution} from '../components/ProductionExecution';
import { InstagramPost } from "../components/InstagramPost";
import {fabricatePrompts} from "../../../server/prompt-factory";
import { anexosStill, anguloTexto, duracaoGerar, falaDe, legendaDe, nomeShot, nomeStill, ordem, passos, stillPrompt, videoPrompt, type ReplicacaoV2, type ShotV2 } from "../../../server/replicacao-prompts";
import type { RefDetail, RefPipeline } from "../../../server/types";
import { AgendarModal, MarcarPostadoModal } from "../replication";
import { ESTUDIO_ABAS, producaoHref, type EstudioAba } from "../replication-experts";
import "../replication-studio.css";

import type { PacoteFrames } from "../../../server/pacote-frames";
import { fragmentLabel, productionTerminology } from "../../../server/production-terms";

const frameUrl = (ref: string, path: string) => media(`replicacoes/${ref}/${path}`);
const seconds = (n: number) => `${n.toFixed(1).replace(".", ",")}s`;
const time = (n: number) => { const ticks = Math.round(n * 10); return `${String(Math.floor(ticks / 600)).padStart(2, "0")}:${String(Math.floor(ticks / 10) % 60).padStart(2, "0")}.${ticks % 10}`; };
const sceneName = (data: any, shot: ShotV2) => data.analise?.shots?.find((s: any) => s.id === shot.id)?.estados?.[0]?.pose || shot.acao || shot.id;
const sceneTakes = (data: any, shot: ShotV2) => (data.shots?.shots ?? []).flatMap((s: any) => s.takes).filter((t: any) => t.ini >= shot.janela[0] - .05 && t.ini < shot.janela[1] - .05);
const go = (to: string) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); };

function Tabs<T extends string>({ label, value, onChange, options, idPrefix }: { label: string; value: T; onChange: (v: T) => void; options: { id: T; label: string; count?: number }[]; idPrefix?: string }) {
  return <div className="rs-tabs" role="tablist" aria-label={label} onKeyDown={e => {
    const index = options.findIndex(o => o.id === value);
    const next = e.key === "ArrowRight" ? (index + 1) % options.length : e.key === "ArrowLeft" ? (index - 1 + options.length) % options.length : e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : -1;
    if (next < 0) return; e.preventDefault(); onChange(options[next].id); requestAnimationFrame(() => (e.currentTarget?.children[next] as HTMLButtonElement | undefined)?.focus());
  }}>{options.map(o => <button key={o.id} type="button" role="tab" id={idPrefix ? `${idPrefix}-${o.id}` : undefined} aria-selected={value === o.id} tabIndex={value === o.id ? 0 : -1} onClick={() => onChange(o.id)}>{o.label}{o.count !== undefined && <span className="num">{o.count}</span>}</button>)}</div>;
}

function StatusButton({ id, item, status, disabled, label }: { id: string; item: string; status: string | undefined; disabled: boolean; label: string }) {
  const [busy, setBusy] = useState(false);
  const done = status === "feito";
  const completed = label === "Vídeo" ? "concluído" : "concluída";
  return <button type="button" className={cx("rs-status-button", done && "is-done")} disabled={disabled || busy} aria-pressed={done} onClick={async () => {
    setBusy(true); await act(() => api(`/api/replicacoes/${id}`, { method: "PATCH", json: { item, status: done ? "pendente" : "feito" } }), done ? "Item voltou para pendente" : `${label}: ${completed}`); setBusy(false);
  }}><span className="rs-checkbox" aria-hidden>{done && <Check size={12} />}</span>{busy ? "Salvando…" : done ? `${label} ${completed}` : `Marcar ${label.toLowerCase()} como ${completed}`}</button>;
}

type FlowShot = { asrReview?:{notes:string;status:string}|null; layer?:string|null; id: string; number: number; label: string; sourceLabel: string; sourceShots: string[]; sourceTakes: string[]; still: string | null; speech: string; duration: number; status: string; reviewStatus?: 'approved'|'pending'|'changed'|'needs_changes'; imageUrl: string | null; clipUrl: string | null; prompt: string | null };
export type FlowProductionData = { workflow?:boolean; editUrl?: string | null; connected: boolean; message?: string; shots: FlowShot[]; collectionUrl?: string; summary?: { shotCount: number; referenceFragmentCount: number; coveredFragmentCount: number | null; outsidePlan: string[] } };

function FlowProduction({ id, data, error }: { id: string; data?: FlowProductionData | null; error?: string | null }) {
  if(data?.workflow)return null;
  const summary = data?.summary;
  const baixados = data?.shots.filter(s => s.status === "baixado").length ?? 0;
  return <div className="rs-flow-production">
    <div className="rs-flow-heading"><div><p className="rs-eyebrow">Plano de geração · Flow</p><h2>{summary ? `${summary.shotCount} shots no plano de geração` : "Shots de geração"}</h2><p>Um shot corresponde a uma geração contínua de vídeo. Esta é a quantidade de vídeos planejados para o Flow.</p></div>
      <div className="rs-flow-links">{data?.collectionUrl && <ButtonLink size="sm" href={data.collectionUrl} external icon={<ExternalLink size={14} />}>Abrir coleção no Flow</ButtonLink>}</div></div>
    {error && <p role="alert" className="rs-alert">{error}</p>}
    {!data && !error && <p className="rs-muted">Carregando estado da produção…</p>}
    {data && !data.connected && <p className="rs-muted">{data.message}</p>}
    {summary && <div className="rs-flow-summary"><span><strong className="num">{summary.shotCount}</strong> shots de geração</span><span><strong className="num">{summary.referenceFragmentCount}</strong> trechos na referência</span><span><strong className="num">{baixados}</strong> clipes baixados</span><p>{summary.coveredFragmentCount === null ? "A correspondência com os trechos originais não foi registrada nesta entrega anterior." : `${summary.coveredFragmentCount} trechos de referência reunidos neste plano de geração.`}{summary.outsidePlan.length > 0 && ` Fora deste plano de geração: ${summary.outsidePlan.map(fragmentLabel).join(", ")}. Confira esses trechos na montagem.`}</p></div>}
    <details className="rs-flow-terms"><summary>Entenda os nomes: shot, trecho de referência, take e imagem inicial</summary><dl><dt>Shot</dt><dd>{productionTerminology.shot}</dd><dt>Trecho de referência</dt><dd>{productionTerminology.referenceFragment}</dd><dt>Take</dt><dd>{productionTerminology.take}</dd><dt>Imagem inicial</dt><dd>{productionTerminology.initialImage}</dd><dt>Clipe</dt><dd>{productionTerminology.clip}</dd></dl></details>
    {data?.connected && <div className="rs-flow-grid">{data.shots.map(shot => <article className="rs-flow-card" key={shot.id}>
      <div className="rs-flow-media">{shot.clipUrl ? <video controls preload="none" playsInline src={shot.clipUrl} aria-label={`Clipe do ${shot.label}`} /> : shot.imageUrl ? <img loading="lazy" src={shot.imageUrl} alt={`Imagem inicial do ${shot.label}`} /> : <span>Imagem inicial não vinculada</span>}</div>
      <div className="rs-flow-body">
        <div className="rs-flow-shot-title"><h3>{shot.label}{shot.layer ? ` · ${shot.layer}` : ""}</h3><span className="num">{shot.duration}s</span></div>
        <StageBadge stage={shot.status === "baixado" ? "pronta" : shot.status === "enviado ao Flow" ? "producao" : "triada"} label={shot.status === "baixado" ? "Clipe baixado" : shot.status === "enviado ao Flow" ? "Enviado ao Flow" : shot.status === "aguarda envio" ? "Aguarda envio" : shot.status} />
        {shot.clipUrl&&<StageBadge stage={shot.reviewStatus==='approved'?'pronta':'triada'} label={shot.reviewStatus==='approved'?'Revisão registrada':shot.reviewStatus==='needs_changes'?'Revisão pediu correções':shot.reviewStatus==='changed'?'Arquivo mudou após a revisão':'Revisão pendente'} />}
        <p className="rs-flow-origin">{shot.sourceLabel}</p>{shot.asrReview&&<p className="rs-inline-note">Conferência de texto: {shot.asrReview.notes}</p>}
        <p>{shot.speech || (shot.layer === "fundo" ? "Fundo sem diálogo. A fala pertence ao plate ou à narração separada." : "Fala não registrada neste plano. Confira o clipe e o roteiro de referência.")}</p>
        <details><summary>{shot.sourceTakes.length ? `${shot.sourceTakes.length} ${shot.sourceTakes.length === 1 ? "take de referência vinculado" : "takes de referência vinculados"}` : "Takes de referência não registrados"}</summary><p>{shot.sourceTakes.join(" · ") || "Correspondência ainda não registrada."}</p></details>
        {shot.prompt && <details><summary>Prompt do shot</summary><pre className="rs-flow-prompt">{shot.prompt}</pre><Button size="sm" icon={<Copy size={14} />} onClick={() => copy(shot.prompt!, "Prompt copiado")}>Copiar prompt do shot</Button></details>}
        <details><summary>IDs dos arquivos</summary><p>ID do vídeo: <code>{shot.id}</code>{shot.still && <><br />ID da imagem inicial: <code>{shot.still}</code></>}</p></details>
        {shot.clipUrl && <ButtonLink size="sm" variant="ghost" href={shot.clipUrl} download={`${shot.id}.mp4`} icon={<Download size={14} />}>Baixar clipe</ButtonLink>}
      </div>
    </article>)}</div>}
  </div>;
}

const ABA_LABEL: Record<EstudioAba, string> = { referencia: "Referência", shots: "Shots", edicao: "Edição", publicacao: "Publicação" };

export function ReplicationStudio({ id, data, versao, onVersao, onEditCopy, configuration, analysis, aba: abaProp, onAba }: {
  id: string; data: any; versao: string; onVersao: (v: string) => void; onEditCopy: () => void; configuration: ReactNode; analysis: ReactNode;
  /** Aba controlada pela URL (sub-rota). Sem `onAba`, a aba fica em estado local. */
  aba?: EstudioAba; onAba?: (a: EstudioAba) => void;
}) {
  const rep = data.replicacao as ReplicacaoV2;
  const [scene, setScene] = useState(0), [takeId, setTakeId] = useState<string | null>(null);
  const [abaLocal, setAbaLocal] = useState<EstudioAba>(abaProp ?? "referencia");
  const view = onAba ? abaProp ?? "referencia" : abaLocal;
  const setView = (a: EstudioAba) => onAba ? onAba(a) : setAbaLocal(a);
  const [panel, setPanel] = useState<"script" | "image" | "video">("script");
  const [preview, setPreview] = useState("frame"), [dialog, setDialog] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const reference = useApi<RefDetail>(`/api/refs/${rep.ref}`);
  const production = useApi<FlowProductionData>(`/api/replicacoes/${id}/producao`);
  const flowShots = production.data?.connected ? production.data.shots : null;
  const linha: RefPipeline | undefined = reference.data?.pipeline?.find(p => p.id === id);
  const shot = rep.shots[Math.min(scene, rep.shots.length - 1)];
  const matchingShots = flowShots?.filter(s => s.sourceShots.includes(shot?.id));
  const takes = shot ? sceneTakes(data, shot) : [];
  const take = takes.find((t: any) => t.id === takeId) ?? takes[0];
  const still = rep.stills.find(s => s.id === shot?.still);
  const st = data.status ?? {};
  const required = ordem(rep).filter(o => o.tipo === "shot" || !rep.stills.find(s => s.id === o.item)?.opcional);
  const done = required.filter(o => st[o.item] === "feito").length;

  const speech = shot ? falaDe(rep, shot, versao) : "";
  const selectedFrame = take?.frame ?? still?.frame;
  const takeCount = (data.shots?.shots ?? []).reduce((n: number, s: any) => n + s.takes.length, 0);
  const selectScene = (index: number) => { setScene(index); setTakeId(null); setPreview("frame"); };
  useEffect(() => { if (video.current && shot) { video.current.pause(); video.current.currentTime = shot.janela[0]; } }, [shot?.id]);
  const exportFile = async (toClipboard = false) => {
    setExporting(true);
    await act(async () => {
      const md = await api<string>(`/api/replicacoes/${id}.md?versao=${versao}`);
      if (toClipboard) return copy(md, "Documentação copiada");
      const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      const a = document.createElement("a"); a.href = url; a.download = `${rep.ref}_${rep.slug}_${versao}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }); setExporting(false);
  };
  const baixarEstado = () => { const a = document.createElement("a"); a.href = `/api/replicacoes/${id}/producao`; a.download = "estado-producao.json"; a.click(); };
  const bloqueio = data.bloqueada ? "Geração bloqueada: revise a análise" : undefined;
  if (!shot) return <div className="rep-studio"><h1>Nenhum trecho disponível</h1><p className="rs-muted">Confira a análise da referência para continuar.</p><Button onClick={() => setDialog("analysis")}>Abrir análise</Button>{dialog && <Modal title="Análise" onClose={() => setDialog(null)}>{analysis}</Modal>}</div>;
  const voltar = producaoHref(rep.slug);
  return <div className="rep-studio">
    <nav className="rs-breadcrumb" aria-label="Caminho"><a href={voltar} onClick={go(voltar)}><ArrowLeft size={14} aria-hidden /> Produção</a><span aria-hidden>/</span><span>{rep.expert}</span><span aria-hidden>/</span><span className="num">{rep.ref}</span></nav>
    <header className="rs-header">
      <div className="rs-title">
        <p className="rs-eyebrow">Estúdio</p>
        <h1>{rep.expert} <span className="num">{rep.ref}</span></h1>
        <div className="rs-meta">{linha && <StageBadge stage={linha.stage} sub={linha.sub || undefined} late={linha.late} />}<span>{rep.formato === "REAL→3D MESMO ÂNGULO" ? "Real → 3D" : rep.formato}</span><span>{rep.engine}</span><span className="num">{seconds(data.shots?.duracao ?? shot.janela[1])} de referência</span></div>
      </div>
      <div className="rs-header-actions">
        <FramesFolderButton id={id} />
        <Button variant="primary" icon={<Download size={16} />} busy={exporting} busyLabel="Preparando…" disabledReason={bloqueio} onClick={() => exportFile()}>Exportar prompts</Button>
        <MoreMenu label="Mais ações do estúdio" items={[
          { label: "Configuração", onSelect: () => setDialog("config") },
          { label: "Editar versões de copy", onSelect: onEditCopy },
          { label: "Abrir análise", onSelect: () => setDialog("analysis") },
          { label: "Ver referência completa", onSelect: () => openRef(rep.ref) },
          { label: "Copiar documentação completa", onSelect: () => exportFile(true), disabledReason: bloqueio },
          { label: "Baixar estado da produção (JSON)", onSelect: baixarEstado },
        ]} />
      </div>
    </header>
    <div className="rs-navigation">
      <Tabs<EstudioAba> label="Área de trabalho" idPrefix="rs-aba" value={view} onChange={setView} options={ESTUDIO_ABAS.map(a => ({ id: a, label: ABA_LABEL[a], count: a === "referencia" ? rep.shots.length : a === "shots" ? flowShots?.length : undefined }))} />
      <button type="button" className={cx("rs-analysis-state", data.bloqueada && "is-warning")} onClick={() => setDialog("analysis")}>{data.bloqueada ? <Info size={14} aria-hidden /> : <CheckCircle2 size={14} aria-hidden />}{data.bloqueada ? "Revisão necessária" : "Análise conferida"}<ChevronRight size={14} aria-hidden /></button>
    </div>
    {view === "shots" && <section role="tabpanel" aria-labelledby="rs-aba-shots"><ProductionExecution id={id}/><FlowProduction id={id} data={production.data} error={production.error} /></section>}
    {view === "referencia" && data.avisos?.length > 0 && <details className="rs-notice" open={data.bloqueada || undefined}><summary>{data.bloqueada ? "Geração bloqueada: revise a análise" : `${data.avisos.length} pontos de atenção para revisar`}</summary><ul>{data.avisos.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul><Button size="sm" variant="ghost" onClick={() => setDialog("analysis")}>Abrir análise</Button></details>}

    {view === "referencia" && <div className="rs-workspace" role="tabpanel" aria-labelledby="rs-aba-referencia">
      <aside className="rs-scene-rail" aria-label="Trechos da referência"><div className="rs-rail-heading"><h2>Trechos da referência</h2><span className="num">{rep.shots.length} trechos</span></div><p className="rs-rail-hint">Selecione um trecho do vídeo original para revisar.</p><ol>{rep.shots.map((s, index) => {
        const image = sceneTakes(data, s)[0]?.frame ?? rep.stills.find(t => t.id === s.still)?.frame;
        return <li key={s.id}><button type="button" className={cx("rs-scene", index === scene && "is-active")} aria-current={index === scene ? "true" : undefined} aria-label={`Trecho ${index + 1}: ${sceneName(data, s)}`} onClick={() => selectScene(index)}>
          {image ? <img src={frameUrl(rep.ref, image)} alt="" loading="lazy" /> : <span className="rs-no-thumbnail"><Film size={20} /></span>}
          <span className="rs-scene-info"><span className="rs-scene-number num">{String(index + 1).padStart(2, "0")}<span>{seconds(s.janela[1] - s.janela[0])}</span></span><strong>{sceneName(data, s)}</strong><span className="rs-scene-status">{flowShots ? flowShots.filter(shot => shot.sourceShots.includes(s.id)).map(shot => shot.label).join(" · ") || (production.data?.summary?.coveredFragmentCount === null ? "Origem não registrada" : "Fora do plano de geração") : st[s.id] === "feito" ? "Vídeo marcado manualmente" : st[s.still] === "feito" ? "Imagem marcada manualmente" : "A preparar"}</span></span>
        </button></li>;
      })}</ol><Button size="sm" variant="ghost" className="rs-reference-link" icon={<Play size={14} />} onClick={() => openRef(rep.ref)}>Ver referência completa</Button></aside>

      <section className="rs-scene-content" aria-label="Prévia do trecho de referência">
        <div className="rs-scene-toolbar"><div><span className="rs-eyebrow num">Trecho {String(scene + 1).padStart(2, "0")} / {String(rep.shots.length).padStart(2, "0")}</span><h2>{sceneName(data, shot)}</h2></div><div className="rs-arrows"><button type="button" className="btn btn--icon btn--secondary" aria-label="Trecho anterior" disabled={scene === 0} onClick={() => selectScene(scene - 1)}><ChevronLeft size={17} /></button><button type="button" className="btn btn--icon btn--secondary" aria-label="Próximo trecho" disabled={scene === rep.shots.length - 1} onClick={() => selectScene(scene + 1)}><ChevronRight size={17} /></button></div></div>
        <div className="rs-preview-modes"><div className="seg seg--sm" role="radiogroup" aria-label="Prévia"><button type="button" role="radio" className={cx(preview === "frame" && "on")} aria-checked={preview === "frame"} onClick={() => setPreview("frame")}><ImageIcon size={14} /> Frame da referência</button><button type="button" role="radio" className={cx(preview === "video" && "on")} disabled={!reference.data?.video_path} aria-checked={preview === "video"} onClick={() => setPreview("video")}><Play size={14} /> Trecho original</button></div><span className="num">{time(shot.janela[0])} — {time(shot.janela[1])}</span></div>
        <div className="rs-stage" aria-live="polite">
          {preview === "frame" ? selectedFrame ? <img className="rs-frame" data-testid="selected-frame" src={frameUrl(rep.ref, selectedFrame)} alt={`Frame de referência ${take?.id ?? still?.take} — ${sceneName(data, shot)}`} /> : <p>Frame indisponível. Confira a análise.</p> : <video key={shot.id} ref={video} controls autoPlay playsInline src={media(reference.data?.video_path)} onLoadedMetadata={e => { e.currentTarget.currentTime = shot.janela[0]; }} onPlay={e => { if (e.currentTarget.currentTime >= shot.janela[1] || e.currentTarget.currentTime < shot.janela[0]) e.currentTarget.currentTime = shot.janela[0]; }} onTimeUpdate={e => { if (e.currentTarget.currentTime >= shot.janela[1]) e.currentTarget.pause(); }} />}
          <span className="rs-source-label">Referência original</span>{preview === "frame" && selectedFrame && <button type="button" className="rs-zoom" aria-label="Ampliar frame" onClick={() => setDialog("zoom")}><Maximize2 size={15} /></button>}
        </div>
        {take?.estado_visual?.pose && <p className="rs-take-state"><span className="num">{take.id}</span> {take.estado_visual.pose}</p>}
        <div className="rs-takes-heading"><h3>Takes deste trecho <span className="num">{takes.length}</span></h3><span>referência original</span></div>
        <div className="rs-takes" aria-label="Takes do trecho de referência">{takes.map((t: any, index: number) => <button type="button" key={t.id} className={cx("rs-take", take?.id === t.id && "is-active")} aria-label={`Take ${index + 1} — ${t.id}`} aria-pressed={take?.id === t.id} onClick={() => { setTakeId(t.id); setPreview("frame"); }}><img src={frameUrl(rep.ref, t.frame)} alt="" loading="lazy" /><strong>{index === 0 ? "Início" : index === takes.length - 1 ? "Final" : `Take ${index + 1}`}</strong><span className="num">{time(t.t_frame ?? t.ini)}{t.id === still?.take ? " · frame inicial" : ""}</span></button>)}</div>
        <p className="rs-context-note"><Info size={13} aria-hidden /> Os takes são momentos visuais deste trecho da referência. O plano de produção pode reunir vários trechos em um único shot.</p>
      </section>

      <aside className="rs-inspector" aria-label="Detalhes do trecho de referência"><Tabs label="Detalhes da cena" value={panel} onChange={setPanel} options={[{ id: "script", label: "Roteiro" }, { id: "image", label: "Imagem" }, { id: "video", label: "Vídeo" }]} />
        <div className="rs-inspector-body" role="tabpanel" aria-label={panel === "script" ? "Roteiro" : panel === "image" ? "Imagem" : "Vídeo"}>
          {panel === "script" && <><div className="rs-section-label"><h3>{shot.tipo === "inserto" ? "Narração na edição" : "Fala deste trecho"}</h3><select className="field rs-select" aria-label="Versão da copy" value={versao} onChange={e => onVersao(e.target.value)}>{rep.copy.versoes.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}</select></div>{speech ? <blockquote>{speech}</blockquote> : <p className="rs-muted">Este trecho não tem fala.</p>}<Button size="sm" variant="ghost" onClick={onEditCopy}>Editar roteiro </Button><div className="rs-divider" /><h3>O que acontece</h3><p className="rs-action-description">{shot.acao}</p>{shot.evento && <p className="rs-muted">{shot.evento}</p>}<details className="rs-disclosure"><summary>Câmera e continuidade</summary><p>{anguloTexto(shot.angulo)}</p>{shot.notas && <p>{shot.notas}</p>}{shot.morfose && <p>{shot.morfose}</p>}</details>{speech !== shot.fala && <details className="rs-disclosure"><summary>Comparar com a fala original</summary><p>{shot.fala || "Sem fala original."}</p></details>}<details className="rs-disclosure"><summary>Legenda para a edição</summary><p>{legendaDe(rep, shot, versao) || "Sem legenda."}</p></details><Button variant="primary" className="rs-full" disabledReason={flowShots ? undefined : bloqueio} onClick={() => flowShots ? setView("shots") : setPanel(st[shot.still] === "feito" ? "video" : "image")}>{flowShots ? "Ver shots na produção" : `Preparar ${st[shot.still] === "feito" ? "shot" : "imagem inicial"}`}</Button></>}
          {panel === "image" && still && <><div className="rs-section-label"><h3>1. Preparar imagem inicial</h3><span className="num">ID da imagem: {still.id}</span></div><p className="rs-muted">Use os anexos abaixo no gerador de imagens.</p><ul className="rs-assets">{anexosStill(rep, still).map(a => <li key={a.slot}>{a.papel === "frame de referência" ? <img src={frameUrl(rep.ref, still.frame)} alt="Frame inicial" /> : <span className="rs-asset-icon"><ImageIcon size={17} /></span>}<div><strong>{a.papel === "frame de referência" ? "Frame inicial do trecho" : "Identidade do expert"}</strong><code>{a.slot}</code></div>{a.papel === "frame de referência" && <a className="btn btn--icon btn--ghost" aria-label="Baixar frame inicial" download href={frameUrl(rep.ref, still.frame)}><Download size={16} /></a>}</li>)}</ul>{fabricatePrompts(rep,shot,versao).layers.map((layer,i)=><section key={`${layer.layer}-${i}`}><h4>{layer.layer === "principal" ? "Imagem inicial" : `Camada: ${layer.layer}`}</h4><PromptBox text={layer.chatgpt} disabledReason={bloqueio} label="imagem · ChatGPT" /><details><summary>Nano Banana 2.1 / Pro</summary><PromptBox text={layer.nanobanana} disabledReason={bloqueio} label="imagem · Nano Banana" /></details></section>)}<details className="rs-disclosure"><summary>Nome do arquivo e conferência</summary><code>{nomeStill(rep, still.id)}</code><p>Confira mãos, objetos, contato e enquadramento antes de animar.</p></details><StatusButton id={id} item={still.id} status={st[still.id]} disabled={data.bloqueada} label="Imagem" /><Button size="sm" variant="ghost" onClick={() => setPanel("video")}>Ir para o vídeo </Button></>}
          {panel === "video" && flowShots && <><h3>Shots que usam este trecho</h3><p className="rs-muted">O trecho da referência pode fazer parte de um shot com outros trechos. Use o prompt e a duração do plano de produção.</p>{matchingShots?.length ? matchingShots.map(s => <p key={s.id} className="rs-matching"><strong>{s.label}</strong> <span className="num">· {s.duration}s</span><br />{s.sourceLabel}</p>) : <p className="rs-muted">Este trecho não tem correspondência registrada nos shots deste plano. Confira as orientações de montagem.</p>}<Button variant="primary" className="rs-full" onClick={() => setView("shots")}>Ver shots na produção </Button></>}
          {panel === "video" && !flowShots && <><div className="rs-section-label"><h3>2. Rascunho de geração</h3><span className="num">{shot.id}</span></div><div className="rs-video-spec"><div><span>Modelo</span><strong>{rep.engine}</strong></div><div><span>Duração</span><strong className="num">{duracaoGerar(shot, speech, rep)} segundos</strong></div><div><span>Imagem inicial</span><strong>Arquivo {shot.still}</strong></div></div>{st[shot.still] !== "feito" && <p className="rs-inline-note">Prepare e confira a imagem inicial antes de gerar o shot.</p>}{fabricatePrompts(rep,shot,versao).layers.map((layer,i)=><section key={`${layer.layer}-${i}`}><h4>{layer.layer === "principal" ? "Vídeo" : `Geração separada: ${layer.layer}`}</h4><PromptBox text={layer.video} disabledReason={bloqueio} label={`vídeo · ${layer.layer}`} /></section>)}<details className="rs-disclosure"><summary>Anexos e instruções completas</summary><ol>{passos(rep, shot, versao).map((x, i) => <li key={i}>{x}</li>)}</ol><code>{nomeShot(rep, shot.id, versao)}</code></details><StatusButton id={id} item={shot.id} status={st[shot.id]} disabled={data.bloqueada} label="Vídeo" /></>}
        </div><div className="rs-inspector-foot num"><span>{fragmentLabel(shot.id)}</span><span>{seconds(shot.janela[1] - shot.janela[0])} na referência</span></div>
      </aside>
    </div>}

    {view === "edicao" && <section className="rs-edit" role="tabpanel" aria-labelledby="rs-aba-edicao"><div><p className="rs-eyebrow">Da geração ao vídeo final</p><h2>Montagem</h2><p className="rs-muted">Use as janelas da referência para montar os clipes, aplicar a narração e incluir as legendas.</p>{flowShots ? flowShots.some(s => s.status !== "baixado") && <p className="rs-inline-note">{flowShots.filter(s => s.status !== "baixado").length} shots ainda estão sem clipe baixado. Confira o plano na aba Shots.</p> : <p className="rs-inline-note">O plano de geração ainda não está vinculado. Os marcadores da referência não definem a quantidade de shots.</p>}<h3>Orientações de montagem</h3><ul>{rep.pos?.map(x => <li key={x}>{x}</li>)}</ul>{!!rep.decisoes?.length && <><h3>Decisões pendentes</h3><ul>{rep.decisoes.map(x => <li key={x}>{x}</li>)}</ul></>}<Button disabledReason={bloqueio} icon={<Copy size={15} />} onClick={() => exportFile(true)}>Copiar documentação completa</Button></div>
      <aside><h3>Finalização</h3><p className="rs-muted">Marque quando a montagem estiver pronta. A publicação fica na aba Publicação.</p><StatusButton id={id} item="EDITADO" status={st.EDITADO} label="Edição" disabled={data.bloqueada} />{production.data?.editUrl && <video className="rs-edited" controls playsInline preload="metadata" src={production.data.editUrl} aria-label="Vídeo editado" />}<Button variant="secondary" className="rs-full" onClick={() => setView("publicacao")}>Ir para Publicação </Button></aside></section>}

    {view === "publicacao" && <section role="tabpanel" aria-labelledby="rs-aba-publicacao"><Publicacao id={id} data={data} rep={rep} linha={linha} editUrl={production.data?.editUrl ?? null} capa={media(reference.data?.thumb_path) ?? null} /></section>}

    <footer className="rs-footer num"><span>{rep.shots.length} trechos de referência <span>·</span> {takeCount} takes de referência{flowShots && <><span>·</span> {flowShots.length} shots de geração</>}</span><span>{flowShots ? `${flowShots.filter(s => s.status === "baixado").length}/${flowShots.length} clipes baixados` : `${done}/${required.length} marcadores manuais`}</span></footer>
    {dialog === "config" && <Modal title="Configuração da replicação" onClose={() => setDialog(null)} width={620}><div className="rep-studio rs-modal"><p className="rs-muted">Alterar formato, modelo ou roteiro reinicia os marcadores de produção.</p>{configuration}<div className="rs-divider" /><h3>Expert</h3><p>{rep.expert}</p><p className="rs-muted">Identidade: <code>{rep.avatar}</code></p><Button onClick={() => { setDialog(null); onEditCopy(); }}>Editar versões de copy</Button></div></Modal>}
    {dialog === "analysis" && <Modal title="Análise da referência" onClose={() => setDialog(null)} width={900}>{analysis}</Modal>}
    {dialog === "zoom" && selectedFrame && <Modal title={`${shot.id} · ${take?.id ?? still?.take}`} onClose={() => setDialog(null)} width={700}><img className="rs-zoom-image" src={frameUrl(rep.ref, selectedFrame)} alt={`Frame ampliado ${take?.id}`} /></Modal>}
  </div>;
}

type PubProps = { id: string; data: any; rep: ReplicacaoV2; linha?: RefPipeline; editUrl: string | null; capa: string | null };

/**
 * Aba Publicação. Perfil com Postagens.md no vault: cada variação (versão da legenda × horário × canal) é um post próprio,
 * com estado próprio (fonte única: a seção da nota). Sem nota: a publicação antiga, uma por replicação.
 */
function Publicacao(props: PubProps) {
  const posts = useApi<{ itens: PostItem[]; gerido?: boolean }>(`/api/posts?replicacao=${encodeURIComponent(props.id)}`);
  if (!posts.data) return posts.error ? <div className="rs-pub" role="alert"><p>Não foi possível ler os posts: {posts.error}</p><button onClick={posts.reload}>Tentar novamente</button></div> : <div className="rs-pub"><p className="rs-muted">Lendo os posts…</p></div>;
  return posts.data.gerido ? <PublicacaoPosts {...props} posts={posts.data.itens} /> : <PublicacaoLegada {...props} />;
}

const ROTULO_PUB: Record<string, string> = { postada: "Postado", agendada: "Agendado", pronta: "Pronto, sem data", producao: "Em produção", arquivada: "Arquivado" };
const ordemPost = (a: PostItem, b: PostItem) => (a.versao ?? "").localeCompare(b.versao ?? "", "pt-BR", { numeric: true }) || String(a.agendado_para ?? "9").localeCompare(String(b.agendado_para ?? "9"));

function PublicacaoPosts({ id, rep, editUrl, posts }: PubProps & { posts: PostItem[] }) {
  const loc = useLocation();
  const pedido = new URLSearchParams(loc.search).get("post");
  const lista = [...posts].sort(ordemPost);
  const abertos = lista.filter((p) => p.stage !== "postada" && p.stage !== "arquivada");
  const [sel, setSel] = useState<string | null>(pedido);
  const atual = lista.find((p) => p.id === sel) ?? lista.find((p) => p.id === pedido) ?? abertos[0] ?? lista[0] ?? null;
  const [modal, setModal] = useState<null | { tipo: "postado" | "corrigir" | "agendar" | "desmarcar"; p: PostItem }>(null);
  const versoes = [...new Set(lista.flatMap((p) => p.versoes).concat(lista.length ? [] : ["V1"]))];
  const usadas = new Set(lista.filter((p) => p.stage !== "arquivada").map((p) => p.versao));
  const [nova, setNova] = useState<{ versao: string; canal: string; quando: string } | null>(null);
  const titulo = (p: PostItem) => `${rep.ref} · ${p.versao ?? ""}${p.canal ? ` · ${p.canal}` : ""}`;
  const quando = (p: PostItem) => p.stage === "postada" ? (p.postado_em ? `postado ${fmtDateTime(p.postado_em)}` : "postado · data não informada")
    : p.agendado_para ? `${p.late ? "venceu" : "agendado"} ${fmtDateTime(p.agendado_para)}` : "sem data";
  const criar = async () => {
    if (!nova) return;
    const r = await act(() => novoPost({ replicacao: id, versao: nova.versao, canal: nova.canal || null, agendado_para: nova.quando ? new Date(nova.quando).toISOString() : null }), `Post ${nova.versao} criado`);
    if (r) { setNova(null); setSel(r.id); }
  };
  return <div className="rs-pub">
    <div className="rs-pub-post">
      {/* A legenda fica na linha de cada post (lado direito), não embaixo do vídeo. */}
      {atual && <InstagramPost compact post={{ ...postCard(atual), legenda: null, midia_video: atual.video || editUrl ? { src: atual.video ?? editUrl } : null }} />}
    </div>
    <div className="rs-pub-side">
      <p className="rs-eyebrow">Publicação · {lista.length === 1 ? "1 post" : `${lista.length} posts`} deste vídeo</p>
      <h2>{abertos.length ? `${abertos.length} para postar` : lista.some((p) => p.stage === "postada") ? "Todos postados" : "Nenhum post ainda"}</h2>
      <p className="rs-muted">Cada variação é um post próprio: marcar a V1 não marca as outras. Tudo fica na nota Postagens.md do perfil, que o painel também lê.</p>
      <ul className="rs-posts">
        {lista.map((p) => (
          <li key={p.id} className={cx("rs-post", atual?.id === p.id && "is-sel", p.stage === "arquivada" && "is-arq")}>
            <button type="button" className="rs-post-h" aria-pressed={atual?.id === p.id} onClick={() => setSel(p.id)}>
              <b>{p.versao ?? "—"}</b>{p.canal && <span>{p.canal}</span>}
              <StageBadge stage={p.stage === "arquivada" ? "pronta" : p.stage} label={ROTULO_PUB[p.stage]} late={p.late} />
              <span className="num rs-post-q">{quando(p)}</span>
            </button>
            {p.legenda ? <p className={cx("rs-post-leg", atual?.id !== p.id && "is-curta")}>{p.legenda}</p> : <p className="rs-post-leg rs-muted">Sem legenda ainda.</p>}
            <div className="rs-post-a">
              {p.stage === "postada" ? <>
                {p.post_url && <ButtonLink size="sm" variant="ghost" href={p.post_url} external icon={<ExternalLink size={14} />}>Ver post</ButtonLink>}
                <Button size="sm" variant="ghost" icon={<CalendarClock size={14} />} onClick={() => setModal({ tipo: "corrigir", p })}>Editar</Button>
                {p.post_url && <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => act(() => api(`/api/replicacoes/${encodeURIComponent(id)}/publicacao/atualizar?post=${encodeURIComponent(p.id)}`, { method: "POST" }), "Dados do post atualizados")}>Atualizar dados</Button>}
                <Button size="sm" variant="ghost" onClick={() => setModal({ tipo: "desmarcar", p })}>Desmarcar</Button>
              </> : p.stage === "arquivada" ? (
                <Button size="sm" icon={<ArchiveRestore size={14} />} onClick={() => act(() => patchPost(p.id, { publicacao: "a_publicar" }), "Voltou para a fila de postagem")}>Desarquivar</Button>
              ) : <>
                <Button size="sm" variant="primary" icon={<Send size={14} />} onClick={() => setModal({ tipo: "postado", p })}>Postei</Button>
                <Button size="sm" icon={<CalendarClock size={14} />} onClick={() => setModal({ tipo: "agendar", p })}>{p.agendado_para ? "Reagendar" : "Agendar"}</Button>
                <Button size="sm" variant="ghost" icon={<Archive size={14} />} onClick={() => void arquivarPost(p.id)}>Arquivar</Button>
              </>}
              {p.legenda && <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => copy(p.legenda!, `Legenda ${p.versao ?? ""} copiada`)}>Copiar legenda</Button>}
            </div>
          </li>
        ))}
      </ul>
      {nova ? (
        <form className="rs-post-novo" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
          <label>Versão da legenda<select className="field" value={nova.versao} onChange={(e) => setNova({ ...nova, versao: e.target.value })}>
            {(versoes.length ? versoes : ["V1"]).map((v) => <option key={v} value={v}>{v}{usadas.has(v) ? " (repetir)" : ""}</option>)}
          </select></label>
          <label>Onde<select className="field" value={nova.canal} onChange={(e) => setNova({ ...nova, canal: e.target.value })}>
            <option value="">—</option><option>Reels teste</option><option>Feed</option>
          </select></label>
          <label>Data e hora (opcional)<input type="datetime-local" className="field num" value={nova.quando} onChange={(e) => setNova({ ...nova, quando: e.target.value })} /></label>
          <div className="rs-post-a"><Button type="submit" size="sm" variant="primary">Criar post</Button><Button size="sm" variant="ghost" onClick={() => setNova(null)}>Cancelar</Button></div>
        </form>
      ) : (
        <Button icon={<Plus size={15} />} onClick={() => setNova({ versao: (versoes.find((v) => !usadas.has(v)) ?? versoes[0] ?? "V1"), canal: "", quando: "" })}>Novo post (variação)</Button>
      )}
      {editUrl && <Button icon={<FolderOpen size={15} />} onClick={() => act(() => api(`/api/replicacoes/${id}/producao/editado/revelar`, { method: "POST" }), "Vídeo aberto no Finder")}>Abrir vídeo no Finder</Button>}
    </div>
    {modal?.tipo === "postado" && <MarcarPostadoModal id={id} post={modal.p.id} titulo={titulo(modal.p)} onClose={() => setModal(null)} />}
    {modal?.tipo === "corrigir" && <MarcarPostadoModal id={id} post={modal.p.id} titulo={titulo(modal.p)} corrigir url={modal.p.post_url} postadoEm={modal.p.postado_em} onClose={() => setModal(null)} />}
    {modal?.tipo === "agendar" && <AgendarModal id={id} post={modal.p.id} titulo={titulo(modal.p)} agendadoPara={modal.p.agendado_para} onClose={() => setModal(null)} />}
    {modal?.tipo === "desmarcar" && <Modal title={<>Desmarcar <em>postado</em>?</>} onClose={() => setModal(null)} width={460}
      footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { if (await act(() => unmarkPosted(id, modal.p.id), "Marcação de postado removida")) setModal(null); }}>Desmarcar</Button></>}>
      <p className="text-[14px] text-ink-2">Só o post {modal.p.versao}{modal.p.canal ? ` · ${modal.p.canal}` : ""} volta para a fila. O post no Instagram não é afetado.</p>
    </Modal>}
  </div>;
}

function PublicacaoLegada({ id, data, rep, linha, editUrl, capa }: PubProps) {
  const [modal, setModal] = useState<null | "postado" | "corrigir" | "agendar" | "desmarcar">(null);
  const [refreshing, setRefreshing] = useState(false);
  const postado = data.status?.POSTADO === "feito" || !!data.postUrl;
  const refresh = async () => {
    setRefreshing(true);
    await act(() => api(`/api/replicacoes/${encodeURIComponent(id)}/publicacao/atualizar`, { method: "POST" }), "Dados do post atualizados");
    setRefreshing(false);
  };
  const postUrl: string | null = data.postUrl ?? null;
  const postadoEm: string | null = data.postadoEm ?? null;
  const agendado = linha?.agendadoPara ?? null;
  const editado = data.status?.EDITADO === "feito" || !!editUrl;
  const titulo = `${rep.ref} · ${rep.expert}`;
  const stage = postado ? "postada" : linha?.stage ?? (editado ? "pronta" : "producao");
  // Legenda do post (library/replicacoes/<REF>/<slug>/legendas-post.json): versões de teste; sem o arquivo, cai na fala montada.
  const versoes: { id: string; nome: string; texto: string }[] = data.legendasPost?.versoes ?? [];
  const [versao, setVersao] = useState(0);
  const legendaPost = versoes[versao]?.texto ?? null;
  return <div className="rs-pub">
    <div className="rs-pub-post">
      <InstagramPost compact post={{
        id, formato: "reel", proporcao: "9/16", titulo, capa,
        perfil: { nome: rep.expert, handle: data.legendasPost?.handle ?? null },
        midia_video: editUrl ? { src: editUrl } : null,
        legenda: legendaPost ?? legendaFinal(rep, data),
        status: stage, sub: linha?.sub || null, atrasada: linha?.late || undefined,
        contexto: postado ? (postadoEm ? `postado ${fmtDateTime(postadoEm)}` : "postado · data não disponível") : agendado ? `agendado ${fmtDateTime(agendado)}` : editado ? "vídeo final montado" : "vídeo final ainda não montado",
      }} />
    </div>
    <div className="rs-pub-side">
      <p className="rs-eyebrow">Publicação</p>
      <h2>{postado ? "Postado" : agendado ? "Agendado" : editado ? "Pronto para postar" : "Ainda em produção"}</h2>
      <dl className="rs-pub-dl">
        <dt>Estado</dt><dd><StageBadge stage={stage} sub={postUrl ? undefined : linha?.sub || undefined} late={linha?.late} href={postUrl ?? undefined} label={postUrl ? "Postada · ver ↗" : undefined} /></dd>
        <dt>Data do post</dt><dd className="num">{postadoEm ? fmtDateTime(postadoEm) : "—"}</dd>
        {data.registradoEm && <><dt>Marcado em</dt><dd className="num">{fmtDateTime(data.registradoEm)}</dd></>}
        <dt>Agendado para</dt><dd className="num">{agendado ? fmtDateTime(agendado) : "—"}</dd>
        <dt>Link</dt><dd>{postUrl ? <a className="rs-link" href={postUrl} target="_blank" rel="noreferrer">{postUrl.replace(/^https?:\/\/(www\.)?/, "")} <ExternalLink size={12} aria-hidden /></a> : "—"}</dd>
      </dl>
      {versoes.length > 0 && <div className="rs-pub-legendas">
        <p className="rs-eyebrow">Legenda do post</p>
        <div className="rs-pub-versoes" role="group" aria-label="Versão da legenda">{versoes.map((v, i) => <Button key={v.id} size="sm" variant={i === versao ? "primary" : "ghost"} aria-pressed={i === versao} onClick={() => setVersao(i)}>{v.id}</Button>)}</div>
        <p className="rs-muted">{versoes[versao]?.nome}</p>
        <Button size="sm" icon={<Copy size={15} />} onClick={() => copy(versoes[versao].texto, `Legenda ${versoes[versao].id} copiada`)}>Copiar legenda {versoes[versao]?.id}</Button>
      </div>}
      {data.arquivadoEm && <p className="rs-inline-note">Arquivada em {fmtDateTime(data.arquivadoEm)}: fora da fila de postagem e dos painéis. Nada foi apagado.</p>}
      {!editado && !postUrl && <p className="rs-inline-note">A edição ainda não foi marcada como concluída. Se o post já está no ar, registre mesmo assim: o post publicado é o fato.</p>}
      {data.publicacaoInfo && <div className="rs-inline-note">
        <p>Dados do post · {fmtDateTime(data.publicacaoInfo.coletadoEm)}</p>
        <p>Visualizações: {data.publicacaoInfo.views?.toLocaleString("pt-BR") ?? "Não disponível"} · Curtidas: {data.publicacaoInfo.likes?.toLocaleString("pt-BR") ?? "Não disponível"} · Comentários: {data.publicacaoInfo.comments?.toLocaleString("pt-BR") ?? "Não disponível"}</p>
      </div>}
      <div className="rs-pub-actions">
        {postado ? <>
          {postUrl && <ButtonLink variant="primary" href={postUrl} external icon={<ExternalLink size={15} />}>Ver post</ButtonLink>}
          {postUrl && <Button icon={<RefreshCw size={15} />} busy={refreshing} busyLabel="Atualizando…" onClick={refresh} title="Buscar novamente data e métricas pelo link anexado">Atualizar dados do post</Button>}
          <Button icon={<CalendarClock size={15} />} onClick={() => setModal("corrigir")}>Editar publicação</Button>
          <Button variant="danger" onClick={() => setModal("desmarcar")}>Desmarcar postado</Button>
        </> : <>
          <Button variant="primary" icon={<Send size={15} />} onClick={() => setModal("postado")}>Marcar como postado</Button>
          <Button icon={<CalendarClock size={15} />} onClick={() => setModal("agendar")}>{agendado ? "Reagendar" : "Agendar"}</Button>
        </>}
        {data.arquivadoEm
          ? <Button icon={<ArchiveRestore size={15} />} onClick={() => act(() => archiveItem(id, false), "Voltou para a fila de postagem")}>Desarquivar</Button>
          : !postado && <Button variant="ghost" icon={<Archive size={15} />} onClick={() => void arquivar(id)} title="Tirar da fila de postagem (nada é apagado)">Arquivar</Button>}
        {editUrl && <Button icon={<FolderOpen size={15} />} onClick={() => act(() => api(`/api/replicacoes/${id}/producao/editado/revelar`, { method: "POST" }), "Vídeo aberto no Finder")}>Abrir no Finder</Button>}
      </div>
    </div>
    {modal === "postado" && <MarcarPostadoModal id={id} titulo={titulo} onClose={() => setModal(null)} />}
    {modal === "corrigir" && <MarcarPostadoModal id={id} titulo={titulo} corrigir url={postUrl} postadoEm={postadoEm} onClose={() => setModal(null)} />}
    {modal === "agendar" && <AgendarModal id={id} titulo={titulo} agendadoPara={agendado} onClose={() => setModal(null)} />}
    {modal === "desmarcar" && <Modal title={<>Desmarcar <em>postado</em>?</>} onClose={() => setModal(null)} width={460}
      footer={<><Button variant="ghost" onClick={() => setModal(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { if (await act(() => unmarkPosted(id), "Marcação de postado removida")) setModal(null); }}>Desmarcar</Button></>}>
      <p className="text-[14px] text-ink-2">O link <span className="num break-all">{postUrl}</span> e a data do post deixam de valer nos painéis. O post no Instagram não é afetado.</p>
    </Modal>}
  </div>;
}

function legendaFinal(rep: ReplicacaoV2, data: any): string | null {
  try { return rep.shots.map(s => legendaDe(rep, s, data.replicacao?.copy?.ativa ?? rep.copy.ativa)).filter(Boolean).join(" ") || null; } catch { return null; }
}

function PromptBox({ text, disabledReason, label }: { text: string; disabledReason?: string; label: string }) {
  return <div className="rs-prompt"><Button variant="primary" className="rs-full" disabledReason={disabledReason} icon={<Copy size={14} />} onClick={() => copy(text, `Prompt de ${label} copiado`)}>Copiar prompt de {label}</Button><details open><summary>Ver prompt completo</summary><pre>{text}</pre></details></div>;
}

/** "Preparar frames": ação explícita (POST) com aria-busy; a pasta só abre depois, por escolha. */
export function FramesFolderButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [opening, setOpening] = useState("");
  const [pack, setPack] = useState<PacoteFrames>();
  const prepare = async () => {
    setLoading(true); setPack(undefined);
    const data = await act(() => api<PacoteFrames>(`/api/replicacoes/${id}/frames`, { method: "POST" }));
    setPack(data); setLoading(false); if (data) setOpen(true);
  };
  const reveal = async (escopo: "principais" | "todos") => {
    setOpening(escopo);
    await act(() => api(`/api/replicacoes/${id}/frames/reveal`, { method: "POST", json: { escopo } }), "Pasta aberta no Finder");
    setOpening("");
  };
  return <><Button icon={<FolderOpen size={16} />} busy={loading} busyLabel="Preparando…" onClick={prepare} title="Gera o lote de JPEGs dos frames da referência no computador">Preparar frames</Button>
    {open && pack && <Modal title="Frames da referência" onClose={() => setOpen(false)} width={600}><div className="rep-studio rs-modal" aria-busy={!!opening}>
      <p className="rs-muted">As imagens estão no computador. Abra a pasta e arraste os JPEGs para o Flow ou Omni.</p>
      <div className="rs-frame-folders"><section><h3>Frames iniciais · <span className="num">{pack.total_imagens_base}</span> arquivos</h3><p>Frames dos {pack.total_shots} trechos da referência. Trechos que compartilham a mesma imagem usam um único arquivo. A quantidade de shots para gerar aparece na aba Shots.</p><Button variant="primary" className="rs-full" busy={opening === "principais"} busyLabel="Abrindo…" disabledReason={opening && opening !== "principais" ? "Aguarde a outra pasta abrir" : undefined} icon={<FolderOpen size={16} />} onClick={() => reveal("principais")}>Abrir frames iniciais no Finder</Button><code>{pack.principais}</code></section>
      <section><h3>Todos os takes · <span className="num">{pack.total_takes}</span> frames</h3><p>Inclui os momentos intermediários para conferir a evolução dos trechos da referência.</p><Button className="rs-full" busy={opening === "todos"} busyLabel="Abrindo…" disabledReason={opening && opening !== "todos" ? "Aguarde a outra pasta abrir" : undefined} icon={<FolderOpen size={16} />} onClick={() => reveal("todos")}>Abrir todos os takes no Finder</Button><code>{pack.todos}</code></section></div>
      <p className="rs-muted">São frames da referência original. A contact sheet do expert é um anexo separado. O manifesto registra os trechos de referência, takes, tempos e hashes.</p>
    </div></Modal>}
  </>;
}
