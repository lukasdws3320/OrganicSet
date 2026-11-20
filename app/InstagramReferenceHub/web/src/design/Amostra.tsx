import { Download, FolderOpen, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { Stage } from "../../../server/types";
import { STAGES } from "../../../server/types";
import { BatchBar } from "../components/BatchBar";
import { FacetBar } from "../components/FacetBar";
import { InstagramPost, type PostData, type PostSlide } from "../components/InstagramPost";
import { LifecycleBar } from "../components/LifecycleBar";
import { StageBadge, type BadgeState } from "../components/StageBadge";
import { setTheme, theme, toast, toastUndo, useStore } from "../lib";
import { Button, ButtonLink, Chip, CheckList, Empty, ErrorState, IconButton, Modal, MoreMenu, Segmented, Skeleton, Toaster } from "../ui";

/** Página de amostra (/?amostra=1): todos os componentes do pacote H3 com dados fixos, sem API. */

const TONS = ["#E9D8C4", "#D9C3A5", "#F1E4D3", "#CDBBA0", "#E4D2BC", "#DCC9B0", "#EFDCC6", "#D3BE9F", "#E7D5BF", "#D8C4AA"];
const PRATOS = ["Pão de queijo de frigideira", "Bolo de caneca", "Panqueca de banana", "Cookies de aveia", "Muffin de cenoura",
  "Wrap de frango", "Pudim fit", "Picolé de iogurte", "Crepioca", "Lanche da escola"];
function slideSvg(i: number, ori = false) {
  const bg = ori ? "#2B2A27" : TONS[i % TONS.length];
  const fg = ori ? "#F2EFE9" : "#141414";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1440"><rect width="1080" height="1440" fill="${bg}"/>
<circle cx="820" cy="380" r="260" fill="${ori ? "#3A3935" : "#FFFFFF"}" opacity=".55"/><circle cx="300" cy="1060" r="190" fill="#EE794E" opacity="${ori ? ".35" : ".22"}"/>
<text x="90" y="250" font-family="Georgia,serif" font-size="210" fill="${fg}">${i + 1}</text>
<text x="96" y="1250" font-family="Georgia,serif" font-style="italic" font-size="78" fill="${fg}">${PRATOS[i]}</text>
<text x="98" y="1330" font-family="ui-monospace,monospace" font-size="34" letter-spacing="3" fill="${fg}" opacity=".7">${ori ? "REFERÊNCIA · @minicheffelicia" : "RECEITINHA " + String(i + 1).padStart(2, "0") + "/10"}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const PENDENTES = new Set([4, 7, 9]);
const SLIDES: PostSlide[] = Array.from({ length: 10 }, (_, i) => PENDENTES.has(i + 1)
  ? { n: i + 1, estado: i + 1 === 9 ? "gerando" : "pendente" }
  : { n: i + 1, estado: "pronto", src: slideSvg(i), w: 1080, h: 1440, alt: `Slide ${i + 1}: ${PRATOS[i]}`, ref_original: slideSvg(i, true) });

const CARROSSEL: PostData = {
  id: "amostra-carrossel",
  chave: { ref: "REF-2026-10-0159", hub_slug: "bruno-goytacaz" },
  perfil: { handle: "timedasestrelas", nome: "Bruno Goytacaz" },
  formato: "carrossel",
  proporcao: "3/4",
  titulo: "Lanche da escola em 10 receitas",
  slides: SLIDES,
  total_previsto: 10,
  legenda: { texto: "Tem dias que a criatividade para montar o lanche simplesmente acaba, né? Por isso separei 10 receitas que vão direto da geladeira para a lancheira.\n\nComenta CARDÁPIO que eu te mando a lista completa." },
  status: "producao",
  sub: "7/10 slides",
  contexto: "Carrossel · 27/10 17:30",
  avisos: ["CTA divergente: a legenda pede CARDÁPIO, o Posts.md diz LIVRO."],
  hub_url: "#",
};
const REEL: PostData = {
  id: "amostra-reel",
  chave: { ref: "REF-2026-10-0163" },
  perfil: { handle: "timedasestrelas" },
  formato: "reel",
  proporcao: "9/16",
  titulo: "Pudim fit sem açúcar",
  midia_video: { poster: slideSvg(6), duracao_s: 41 },
  legenda: "Pudim fit sem açúcar e sem forno. Salva pra fazer no fim de semana.",
  status: "postada",
  sub: "26/10",
  contexto: "Reel · postado 26/10 16:26",
};

const FORMATOS = [{ value: 1, label: "Falando pra câmera", n: 41 }, { value: 2, label: "Receita passo a passo", n: 33 }, { value: 3, label: "React", n: 12 }, { value: 4, label: "Personagens falantes", n: 9 }];
const OBJETIVOS = [{ value: 1, label: "Alcance", n: 60 }, { value: 2, label: "Educar", n: 38 }, { value: 3, label: "Vender", n: 21 }, { value: 4, label: "Captação (comente X)", n: 17 }];
const COUNTS: Partial<Record<Stage, number>> = { atribuida: 3, producao: 1, pronta: 10, agendada: 0, postada: 2 };

export function Amostra() {
  const t = useStore(theme);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(false);
  const [sel, setSel] = useState(2);
  const [tipo, setTipo] = useState<"tudo" | "reel" | "carrossel">("tudo");
  const [formato, setFormato] = useState<number[]>([2]);
  const [objetivo, setObjetivo] = useState<number[]>([]);
  const [semCriador, setSemCriador] = useState(false);
  const [lista, setLista] = useState<number[]>([1]);
  const clear = useCallback(() => setSel(0), []);
  const salvar = () => { setBusy(true); setTimeout(() => { setBusy(false); toast("Classificação salva"); }, 1600); };

  return (
    <main className="amostra">
      <header className="pg-head">
        <div>
          <h1>Componentes do <em>Hub</em></h1>
          <p className="sub">Amostra do pacote H3 · tokens.css + components.css · densidade compacta</p>
        </div>
        <span className="sp" style={{ marginLeft: "auto" }} />
        <IconButton label={t === "dark" ? "Tema claro" : "Tema escuro"} onClick={() => setTheme(t === "dark" ? "light" : "dark")}>
          {t === "dark" ? <Sun size={16} strokeWidth={1.6} /> : <Moon size={16} strokeWidth={1.6} />}
        </IconButton>
      </header>

      <section aria-labelledby="h-post">
        <div className="sec-h"><h2 id="h-post">Instagram<em>Post</em></h2><span className="mono">10 slides · 3 pendentes · ← → no palco</span></div>
        <div className="amostra-posts">
          <div data-amostra="carrossel">
            <InstagramPost post={CARROSSEL} actions={<>
              <Button size="sm" icon={<FolderOpen />}>Pasta</Button>
              <Button size="sm" variant="primary">Postei</Button>
            </>} />
          </div>
          <InstagramPost post={REEL} actions={<ButtonLink size="sm" href="https://www.instagram.com/" external>Ver no Instagram</ButtonLink>} />
          <InstagramPost compact post={{ ...CARROSSEL, id: "amostra-sem", slides: [], total_previsto: 4, status: "triada", sub: undefined, avisos: [], legenda: null, contexto: "Próximo post" }} />
        </div>
      </section>

      <section aria-labelledby="h-btn">
        <div className="sec-h"><h2 id="h-btn">Button</h2><span className="mono">primary · accent · secondary · ghost · icon · danger</span></div>
        <div className="row">
          <Button variant="accent" icon={<Plus />} kbd="⌘I">Importar</Button>
          <Button variant="primary">Replicar</Button>
          <Button>Revisar</Button>
          <Button variant="ghost">Todas (30)</Button>
          <IconButton label="Baixar" kbd="D" variant="secondary"><Download size={16} strokeWidth={1.6} /></IconButton>
          <Button variant="danger" icon={<Trash2 />} onClick={() => setModal(true)}>Excluir</Button>
          <MoreMenu items={[{ label: "Abrir pasta", onSelect: () => toast("Pasta aberta") }, { label: "Duplicar", onSelect: () => {}, disabledReason: "Ainda não disponível" }]} />
        </div>
        <div className="row">
          <Button size="sm" variant="primary">Postei</Button>
          <Button size="sm">Estúdio</Button>
          <Button size="sm" variant="ghost">Limpar</Button>
          <Button data-amostra="busy" variant="primary" busy={busy} busyLabel="Salvando…" onClick={salvar}>Salvar</Button>
          <Button disabledReason="Escolha ao menos um expert">Replicar para…</Button>
          <Button onClick={() => toastUndo("Referência arquivada", () => toast("Desfeito"))}>Arquivar (toast com Desfazer)</Button>
          <Button onClick={() => toast("Hub respondeu 409: geração bloqueada", "erro")}>Toast de erro</Button>
        </div>
      </section>

      <section aria-labelledby="h-st">
        <div className="sec-h"><h2 id="h-st">StageBadge</h2><span className="mono">glifo + texto; cor só onde pede ação</span></div>
        <div className="row">
          {(STAGES as BadgeState[]).concat(["voce", "atrasada", "divergente"]).map((s) => <StageBadge key={s} stage={s} />)}
        </div>
        <div className="row">
          <StageBadge stage="producao" sub="Edição 12/24" chip />
          <StageBadge stage="agendada" sub="27/10 17:30" chip />
          <StageBadge stage="postada" sub="ver ↗" href="https://www.instagram.com/" />
          <StageBadge stage="pronta" late="venceu 23/10 · há 3 d" />
          <StageBadge stage="producao" divergent="Posts.md diz “em edição”" />
        </div>
      </section>

      <section aria-labelledby="h-lc">
        <div className="sec-h"><h2 id="h-lc">LifecycleBar</h2></div>
        <div style={{ maxWidth: 420 }}><LifecycleBar stage="producao" sub="Edição 12/24" /></div>
        <div style={{ maxWidth: 520 }}><LifecycleBar counts={COUNTS} /></div>
      </section>

      <section aria-labelledby="h-f">
        <div className="sec-h"><h2 id="h-f">FacetBar</h2><span className="mono">Backspace remove o último filtro</span></div>
        <FacetBar
          segment={{ label: "Tipo", value: tipo, onChange: setTipo, options: [{ value: "tudo", label: "Tudo" }, { value: "reel", label: "Reel", n: 191 }, { value: "carrossel", label: "Carrossel", n: 0 }] }}
          facets={[
            { key: "formato", label: "Formato", options: FORMATOS, value: formato, onChange: setFormato, n: 11 },
            { key: "objetivo", label: "Objetivo", options: OBJETIVOS, value: objetivo, onChange: setObjetivo },
            { key: "gancho", label: "Gancho", options: [], value: [], onChange: () => {} },
          ]}
          shortcuts={[{ key: "semcriador", label: "Sem criador", n: 114, active: semCriador, onToggle: () => setSemCriador((v) => !v) }]}
          end={<Segmented label="Densidade" size="sm" value="grade" onChange={() => {}} options={[{ value: "grade", label: "Grade" }, { value: "lista", label: "Lista" }]} />}
          onClear={() => { setFormato([]); setObjetivo([]); setSemCriador(false); }}
        />
        <div className="row">
          <Chip active onClick={() => {}}>Favoritos</Chip>
          <Chip onClick={() => {}}>Tudo</Chip>
          <Chip color="#2E4A7A" onRemove={() => {}}>Bruno Goytacaz</Chip>
          <span className="tagv">Lista de receitas</span>
          <span className="tagv tagv--sug">@minichefluna <span className="q">sugerido</span></span>
        </div>
        <div style={{ maxWidth: 280, position: "static", marginTop: 0 }} className="pop">
          <CheckList value={lista} onChange={setLista} options={[{ value: 1, label: "Lancheira", hint: "12" }, { value: 2, label: "Receitas fit", hint: "30" }]} />
        </div>
      </section>

      <section aria-labelledby="h-e">
        <div className="sec-h"><h2 id="h-e">Estados</h2></div>
        <Empty title={<>Nenhuma replicação <em>ainda</em></>} action={<Button variant="primary">Nova replicação</Button>}>Escolha uma referência na Biblioteca e replique para um expert.</Empty>
        <ErrorState title="Hub respondeu 409" detail="geração bloqueada: corrija a análise/lint antes de marcar concluído" onRetry={() => {}} />
        <div className="row"><Skeleton className="w-[120px]" /><Skeleton ratio="3/4" className="w-[160px]" /></div>
      </section>

      <BatchBar
        count={sel}
        onClear={clear}
        actions={[
          { id: "formato", label: "Formato", mobile: true, popover: () => <CheckList value={formato} onChange={setFormato} options={FORMATOS.map((f) => ({ value: f.value, label: f.label, hint: f.n }))} /> },
          { id: "objetivo", label: "Objetivo", mobile: true, popover: () => <CheckList value={objetivo} onChange={setObjetivo} options={OBJETIVOS.map((f) => ({ value: f.value, label: f.label, hint: f.n }))} /> },
          { id: "criador", label: "Criador", onSelect: () => toast("Criador") },
          { id: "expert", label: "Atribuir expert", onSelect: () => toast("Atribuir") },
          { id: "quadro", label: "Quadro", onSelect: () => toast("Quadro") },
        ]}
        primary={{ label: "Replicar", onSelect: () => setModal(true) }}
      />
      {!sel && <div className="row"><Button onClick={() => setSel(2)}>Mostrar barra de lote</Button></div>}

      {modal && (
        <Modal title="Replicar 2 referências?" onClose={() => setModal(false)}
          footer={<><Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button><Button variant="accent" onClick={() => { setModal(false); toast("Replicação enfileirada"); }}>Replicar para Bruno</Button></>}>
          <p className="text-ink-2">REF-0159 e REF-0160 vão para <b className="text-ink">Bruno Goytacaz</b>. A análise começa na fila.</p>
        </Modal>
      )}
      <Toaster />
    </main>
  );
}
