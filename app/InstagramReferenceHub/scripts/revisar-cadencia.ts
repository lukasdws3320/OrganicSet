import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { revisarCadencia } from '../server/production-timing';

// Somente leitura. Não abre Flow, não resegmenta arquivos e não autoriza geração.
try {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { replication: { type: 'string' }, transcript: { type: 'string' } } });
  if (!values.replication) throw Error('Use --replication /pasta/replicacao.json [--transcript /pasta/transcricao.json]');
  const path = resolve(values.replication), rep = JSON.parse(readFileSync(path, 'utf8'));
  const transcript = resolve(values.transcript ?? resolve(dirname(path), '../transcricao.json'));
  const data = JSON.parse(readFileSync(transcript, 'utf8'));
  if (!Array.isArray(data.palavras)) throw Error('Transcrição precisa de palavras com w, ini e fim.');
  const review = revisarCadencia(rep, data.palavras);
  console.log(JSON.stringify(review, null, 2));
  if (review.bloqueada) process.exitCode = 2;
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
