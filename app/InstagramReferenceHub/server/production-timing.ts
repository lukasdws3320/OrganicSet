/** Revisão local por evidência de fala; não altera transcrição, shots ou planos. */
import { engineValida, falaDe, type ReplicacaoV2, type ShotV2 } from './replicacao-prompts';
import { PARAMS, segmentarFala, type Palavra } from './segmentar';

const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const termina = (s: string) => /[.!?…]["”')\]]?$/.test(s.trim());
const round = (n: number) => Math.round(n * 1000) / 1000;

export function revisarCadencia(rep: ReplicacaoV2, words: Palavra[]) {
  if (!engineValida(rep.engine)) throw Error('Engine sem contrato de cadência; resolver o modelo antes de planejar.');
  if (words.some((w, i) => !w.w || !Number.isFinite(w.ini) || !Number.isFinite(w.fim) || w.ini < 0 || w.fim < w.ini || i > 0 && w.ini < words[i - 1].ini)) {
    throw Error('Timestamps por palavra inválidos ou fora de ordem');
  }
  const presets = /seedance/i.test(rep.engine) ? Array.from({ length: 12 }, (_, i) => i + 4) : /omni|flow/i.test(rep.engine) ? [4, 6, 8, 10] : [4, 6, 8];
  const max = presets.at(-1)!;
  const problemas: string[] = [];
  const ajustes = new Map<number, { from: number; to: number; word: string; reason: string }>();
  const propostas: { sourceShots: string[]; window: [number, number]; words: string[]; fronteiraForcada: boolean }[] = [];
  const falaGerada = (s: ShotV2) => rep.formato !== 'RECEITA POV' && (s.tipo !== 'inserto' || rep.formato === 'REACT') && !!falaDe(rep, s);
  // Fala adaptada não herda tempo da fonte: só vale com medição própria registrada na versão (scripts/medir-fala.ts).
  const medidas = rep.copy.versoes.find(v => v.id === rep.copy.ativa)?.medicoes ?? {};
  const adaptada = (s: ShotV2) => Number.isFinite(medidas[s.id]?.segundos);
  // Fala reescrita (inclusive para silêncio) não depende das bordas das palavras da fonte.
  const reescrita = (s: ShotV2) => adaptada(s) || normal(falaDe(rep, s)) !== normal(s.fala ?? '');
  const medicao = (rows: ShotV2[]) => {
    const start = rows[0].janela[0], end = rows.at(-1)!.janela[1];
    const tokens = words.filter(w => (w.ini + w.fim) / 2 >= start && (w.ini + w.fim) / 2 < end + .001);
    const speech = rows.map(s => falaDe(rep, s)).filter(Boolean).join(' ');
    const sourceSpeech = tokens.map(w => w.w).join(' ');
    let seconds = tokens.length ? tokens.at(-1)!.fim - tokens[0].ini : 0;
    const generated = rows.some(falaGerada);
    let matches = !generated || !!tokens.length && normal(speech) === normal(sourceSpeech);
    if (!matches && rows.every(s => !falaGerada(s) || adaptada(s))) { matches = true; seconds = rows.reduce((n, s) => n + (adaptada(s) ? medidas[s.id].segundos : 0), 0); }
    return { start, end, tokens, speech, seconds, matches, generated };
  };
  const sets: ShotV2[][] = [];
  for (const s of rep.shots) {
    if (!reescrita(s)) for (const boundary of s.janela) {
      const word = words.find(w => w.ini + .03 < boundary && w.fim - .03 > boundary);
      if (word) {
        problemas.push(`${s.id}: fronteira atravessa uma palavra; conferir alinhamento automático.`);
        // Mantém a palavra no lado que já a recebeu pelo centro; propõe a borda inteira.
        ajustes.set(boundary, { from: boundary, to: round((word.ini + word.fim) / 2 >= boundary ? word.ini : word.fim), word: word.w, reason: 'Alinhar a borda sem cortar nem transferir a palavra para outro trecho; validar ação e sentido antes de materializar.' });
      }
    }
    const prev = sets.at(-1), prevShot = prev?.at(-1);
    const joined = prev ? medicao([...prev, s]) : null;
    const sameAngle = !prevShot?.angulo || !s.angulo || JSON.stringify(prevShot.angulo) === JSON.stringify(s.angulo);
    if (prev && prevShot && falaGerada(prevShot) && falaGerada(s) && !termina(falaDe(rep, prevShot)) && Math.abs(prevShot.janela[1] - s.janela[0]) <= .03 && sameAngle && joined?.matches && joined.seconds <= max) prev.push(s);
    else sets.push([s]);
  }
  const groups = sets.map(rows => {
    const m = medicao(rows), ids = rows.map(s => s.id);
    // Silêncio visual usa a ação observada; fala usa seus timestamps, sem piso na janela completa.
    // TROCA DE PRODUTO: o ritmo é o dos cortes da referência; o clipe cobre a janela inteira (até o preset máximo).
    const need = Math.max(m.generated ? m.seconds : m.end - m.start, rep.formato === 'TROCA DE PRODUTO' ? Math.min(m.end - m.start, max) : 0);
    let duration: number | null = m.matches ? presets.find(p => p + .001 >= need) ?? null : null;
    // TROCA DE PRODUTO no Veo 3.1 do Flow (09/11/2026): clipe fixo de 8 s; a edição corta no tempo exato do corte original.
    if (duration !== null && rep.formato === 'TROCA DE PRODUTO' && /^veo/i.test(rep.engine)) duration = max;
    if (m.generated && !m.matches) problemas.push(`${ids.join('+')}: falta medição da fala atual; não aplicar tempo de outra frase ou taxa universal.`);
    if (m.matches && duration === null) {
      problemas.push(`${ids.join('+')}: ${round(need)}s medidos excedem o preset ${max}s; resegmentar preservando todas as palavras e a ação.`);
      if (m.tokens.length) {
        const offset = m.tokens[0].ini;
        const local = m.tokens.map(w => ({ ...w, ini: w.ini - offset, fim: w.fim - offset }));
        const split = segmentarFala(local, [], local.at(-1)!.fim, { ...PARAMS, max_shot: max });
        for (const s of split.filter(s => s.palavras.length)) propostas.push({ sourceShots: ids, window: [round(s.ini + offset), round(s.fim + offset)], words: s.palavras.map(w => w.w), fronteiraForcada: s.forcado });
      }
    }
    return { sourceShots: ids, sourceTakes: [...new Set(rows.flatMap(s => [s.referencia_take, ...(s.takes_extras ?? [])]).filter((t): t is string => !!t))],
      duration, speech: m.speech, speechSeconds: m.generated ? round(m.seconds) : 0, sourceSeconds: round(m.end - m.start),
      measuredWordsPerSecond: m.generated && m.seconds ? round(m.tokens.length / m.seconds) : null,
      reason: duration === null ? 'Revisão pendente: não enviar.' : m.generated ? `Fala medida em ${round(m.seconds)}s; preset ${duration}s. Conferir dicção e ação completas, sem acelerar para caber.` : `Janela visual de ${round(m.end - m.start)}s; preset ${duration}s. Conferir ação completa; eventual narração fica na montagem.`,
      ...(rows.length > 1 ? { actionDirection: rows.map(s => s.acao_geracao ?? s.acao).join('; ') } : {}) };
  });
  return { schema: 'replication-cadence-review/v1', ref: rep.ref, expertSlug: rep.slug,
    authorizedByUser: false, reviewStatus: 'proposta', requiresVisualReview: true, requiresListening: true,
    voicePace: rep.copy.versoes.find(v => v.id === rep.copy.ativa)?.direcao_voz || 'Resolver interpretação pelo contexto da personagem.',
    bloqueada: problemas.length > 0, problemas, ajustesFronteiras: [...ajustes.values()], groups, propostas, postProduction: [] };
}
