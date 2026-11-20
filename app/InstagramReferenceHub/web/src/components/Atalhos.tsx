import { Modal } from "../ui";

/** Folha de atalhos (SPEC §5.2, tecla `?`). Inclui os atalhos do player do viewer (Viewer.tsx). */
const GRUPOS: { titulo: string; itens: [string[], string][] }[] = [
  {
    titulo: "Em qualquer tela",
    itens: [
      [["⌘", "K"], "Buscar ou agir (paleta)"],
      [["⌘", "I"], "Importar link"],
      [["/"], "Buscar"],
      [["T"], "Abrir a triagem"],
      [["?"], "Esta folha de atalhos"],
      [["Esc"], "Fechar painel, diálogo ou viewer"],
    ],
  },
  {
    titulo: "Biblioteca",
    itens: [
      [["J"], "Próxima referência"],
      [["K"], "Referência anterior"],
      [["Enter"], "Abrir no viewer"],
      [["X"], "Selecionar"],
      [["F"], "Favoritar"],
    ],
  },
  {
    titulo: "Triagem",
    itens: [
      [["1", "–", "9"], "Escolher no campo ativo"],
      [["Enter"], "Salvar e avançar"],
      [["S"], "Pular"],
      [["E"], "Arquivar"],
    ],
  },
  {
    titulo: "Viewer",
    itens: [
      [["←", "→"], "Referência anterior / próxima"],
      [["Enter"], "Expandir o painel"],
      [["F"], "Favoritar"],
      [["Espaço"], "Tocar / pausar"],
      [[",", "."], "Quadro anterior / próximo"],
      [["M"], "Marcar o momento do vídeo"],
    ],
  },
];

export function Atalhos({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={<>Atalhos de <em>teclado</em></>} onClose={onClose} width={720}>
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        {GRUPOS.map((g) => (
          <section key={g.titulo} aria-labelledby={`at-${g.titulo}`}>
            <h3 id={`at-${g.titulo}`} className="eyebrow mb-2 text-[10px]">{g.titulo}</h3>
            <dl className="divide-y divide-line border-y border-line">
              {g.itens.map(([teclas, acao]) => (
                <div key={acao + teclas.join()} className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-[13px] text-ink-2">{acao}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {teclas.map((k, i) => k === "–"
                      ? <span key={i} className="text-[11px] text-ink-3">a</span>
                      : <kbd key={i} className="num inline-grid h-6 min-w-6 place-items-center rounded-r1 border border-line-2 bg-sunken px-1.5 text-[11px] text-ink">{k}</kbd>)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
