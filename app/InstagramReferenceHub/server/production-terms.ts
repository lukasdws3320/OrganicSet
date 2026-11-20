/** User-facing vocabulary. Existing file IDs remain stable for Flow recovery. */
type SourceShot = { id: string; sourceShots?: string[] };

export const fragmentLabel = (id: string) => `Trecho ${id.replace(/^SHOT/, "")}`;

export function describeProduction<T extends SourceShot>(shots: T[], referenceIds: string[]) {
  const provenanceComplete = shots.length > 0 && shots.every(s => s.sourceShots && s.sourceShots.length > 0);
  const covered = new Set(shots.flatMap(s => s.sourceShots || []));
  return {
    shots: shots.map((shot, index) => ({
      ...shot,
      number: index + 1,
      label: `Shot ${String(index + 1).padStart(2, "0")}`,
      sourceLabel: shot.sourceShots?.length
        ? `${shot.sourceShots.length === 1 ? "Trecho de referência" : "Trechos de referência"} ${shot.sourceShots.map(s => s.replace(/^SHOT/, "")).join(" + ")}`
        : "Trechos de origem não registrados",
    })),
    summary: {
      shotCount: shots.length,
      referenceFragmentCount: referenceIds.length,
      coveredFragmentCount: provenanceComplete ? referenceIds.filter(id => covered.has(id)).length : null,
      outsidePlan: provenanceComplete ? referenceIds.filter(id => !covered.has(id)) : [],
    },
  };
}

export const productionTerminology = {
  shot: "Uma geração contínua de vídeo no Flow. O total de shots é a quantidade de vídeos planejados.",
  referenceFragment: "Trecho analisado do vídeo original. Um shot pode reunir vários trechos de referência.",
  take: "Momento visual dentro de um trecho de referência, usado para conferir ação e continuidade.",
  initialImage: "Imagem usada para iniciar a geração de um shot. IDs STILL identificam seus arquivos.",
  clip: "Arquivo de vídeo resultante da geração de um shot.",
};
