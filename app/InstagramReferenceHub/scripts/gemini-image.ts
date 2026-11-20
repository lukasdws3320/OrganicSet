// Ponte Nano Banana (Gemini API) para imagens iniciais da fila do Hub (OrganicSet, 09/11/2026).
// Mesmo papel da ponte ChatGPT: lê o pedido do item na fila (prompt Nano Banana + anexos com hash), gera UMA imagem,
// guarda pedido/resposta/recibo na pasta da tentativa e entrega pela mesma rota de "receber-imagem".
// Não abre navegador nem Flow. Chave: ~/.config/instagram-reference-hub/gemini.env (GEMINI_API_KEY=...), colocada pelo aluno.
// Uso: bun scripts/gemini-image.ts --id REF--slug --item STILL01 [--modelo gemini-3-pro-image] [--tamanho 2K]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileHash, imageExtension } from '../server/production-workflow';

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const base = new URL(args.base || process.env.IRH_URL || 'http://127.0.0.1:4317');
const modelo = args.modelo || 'gemini-3-pro-image';
const tamanho = args.tamanho || '2K';

function chave() {
  const f = join(homedir(), '.config/instagram-reference-hub/gemini.env');
  const k = existsSync(f) ? readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*(\S+)\s*$/m)?.[1] : process.env.GEMINI_API_KEY;
  if (!k) throw Error('GEMINI_API_KEY ausente em ~/.config/instagram-reference-hub/gemini.env');
  return k;
}
const mime = (b: Buffer) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' } as Record<string, string>)[imageExtension(b)];

export async function generateGemini(request: { prompt: string; inputs: { path: string; sha256: string; role: string }[]; aspectRatio: string }, destination: string) {
  for (const input of request.inputs) if (fileHash(input.path) !== input.sha256) throw Error('Anexo mudou antes do envio');
  mkdirSync(destination, { recursive: true });
  const reqFile = join(destination, 'request.json'), receiptFile = join(destination, 'receipt.json');
  const reqText = JSON.stringify({ ...request, modelo, tamanho }, null, 2);
  if (existsSync(receiptFile)) {
    const r = JSON.parse(readFileSync(receiptFile, 'utf8'));
    if (createHash('sha256').update(reqText).digest('hex') !== r.requestSha256 || fileHash(r.file) !== r.sha256) throw Error('Pedido ou imagem anterior mudou; recuperar a tentativa sem gerar outra');
    return { ...r, reused: true };
  }
  writeFileSync(reqFile, reqText);
  const parts: any[] = [];
  request.inputs.forEach((x, i) => { const b = readFileSync(x.path); parts.push({ text: `Referência ${i + 1}: ${x.role}.` }, { inline_data: { mime_type: mime(b), data: b.toString('base64') } }); });
  parts.push({ text: request.prompt });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: request.aspectRatio, imageSize: tamanho } } };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave() }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  const j: any = await res.json();
  const resumo = { status: res.status, modelVersion: j.modelVersion, responseId: j.responseId, usage: j.usageMetadata, finishReason: j.candidates?.[0]?.finishReason, promptFeedback: j.promptFeedback, textos: (j.candidates?.[0]?.content?.parts ?? []).filter((p: any) => p.text).map((p: any) => p.text), erro: j.error ? { code: j.error.code, status: j.error.status, message: j.error.message } : undefined };
  writeFileSync(join(destination, 'resposta.json'), JSON.stringify(resumo, null, 2));
  if (!res.ok) throw Error(`Gemini ${res.status} ${j.error?.status ?? ''}: ${String(j.error?.message ?? '').slice(0, 300)}`);
  const img = (j.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
  if (!img) throw Error('Gemini não devolveu imagem (finishReason ' + (resumo.finishReason ?? '?') + '); ver resposta.json');
  const bytes = Buffer.from((img.inlineData ?? img.inline_data).data, 'base64');
  const file = join(destination, 'resultado' + imageExtension(bytes));
  writeFileSync(file, bytes);
  const receipt = { schema: 'irh-gemini-image/v1', provider: 'gemini-api', modelo, modelVersion: j.modelVersion, responseId: j.responseId, tamanho, file, sha256: fileHash(file), requestSha256: createHash('sha256').update(reqText).digest('hex'), usage: j.usageMetadata, generatedAt: new Date().toISOString() };
  writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  return receipt;
}

if (import.meta.main) {
  try {
    if (!args.id || !args.item) throw Error('Uso: bun scripts/gemini-image.ts --id REF--slug --item STILL01');
    const api = async (p: string, init?: RequestInit) => { const r = await fetch(new URL(p, base), init); const j: any = await r.json(); if (!r.ok) throw Error(j.error || JSON.stringify(j)); return j; };
    const id = encodeURIComponent(args.id);
    const s = await api(`/api/replicacoes/${id}/execucao`);
    const job = s.jobs.find((x: any) => x.id === args.item && x.kind === 'image');
    if (!job) throw Error('Item de imagem inexistente: ' + args.item);
    if (job.status !== 'queued') throw Error(`${args.item} está em ${job.status}; só item na fila recebe imagem nova`);
    const library = resolve(process.env.IRH_LIBRARY || join(import.meta.dir, '../library'));
    const [ref, slug] = args.id.split('--');
    const destino = join(library, 'replicacoes', ref, slug, 'producao', s.runId, 'requests', args.item, 'tentativa-' + String(job.attempt).padStart(2, '0'));
    // Reprovação acrescenta "Correção solicitada..." ao prompt base; a versão Nano Banana precisa levar a mesma correção.
    const correcao = job.toolPrompts?.nanobanana && typeof job.basePrompt === 'string' && job.prompt.startsWith(job.basePrompt) ? job.prompt.slice(job.basePrompt.length).trim() : '';
    const receipt = await generateGemini({ prompt: [job.toolPrompts?.nanobanana ?? job.prompt, correcao].filter(Boolean).join('\n'), inputs: job.inputs, aspectRatio: s.plan?.settings?.aspectRatio ?? '9:16' }, destino);
    const r = await fetch(new URL(`/api/replicacoes/${id}/execucao/${encodeURIComponent(args.item)}/imagem`, base), { method: 'POST', headers: { 'X-IRH-Agente': 'gemini-image (Claude Code)' }, body: readFileSync(receipt.file) });
    const st: any = await r.json(); if (!r.ok) throw Error(st.error);
    const novo = st.jobs.find((x: any) => x.id === args.item);
    console.log(JSON.stringify({ item: args.item, tentativa: job.attempt, status: novo.status, arquivo: novo.output, sha256: novo.sha256, modelo: receipt.modelVersion ?? modelo, reutilizado: !!receipt.reused }));
  } catch (e) { console.error(JSON.stringify({ error: (e as Error).message })); process.exitCode = 1; }
}
