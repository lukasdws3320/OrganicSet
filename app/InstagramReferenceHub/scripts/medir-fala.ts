// Mede a fala ADAPTADA de uma versão da copy (OrganicSet, 09/11/2026).
// Fala igual à fonte usa os timestamps da transcrição; fala reescrita não tem timestamps e não pode herdar os da fonte.
// Método: voz sintetizada do sistema (Windows SAPI / macOS say) no idioma da fala, calibrada pelo ritmo real
// da própria referência (segundos falados da fonte ÷ segundos da mesma fonte sintetizada). Grava em copy.versoes[].medicoes.
// Uso: bun scripts/medir-fala.ts --id REF--slug --versao V2 [--base http://127.0.0.1:4317]
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
if (!args.id || !args.versao) throw Error('Uso: bun scripts/medir-fala.ts --id REF--slug --versao V2');
const base = new URL(args.base || process.env.IRH_URL || 'http://127.0.0.1:4317');
const api = async (path: string, init?: RequestInit) => { const r = await fetch(new URL(path, base), { ...init, headers: { 'Content-Type': 'application/json', 'X-IRH-Agente': 'medir-fala', ...(init?.headers ?? {}) } }); const j: any = await r.json(); if (!r.ok) throw Error(j.error || JSON.stringify(j)); return j; };

const atual = await api('/api/replicacoes/' + encodeURIComponent(args.id));
const rep = atual.replicacao;
if (!rep) throw Error('Replicação sem prompts');
const versao = rep.copy.versoes.find((v: any) => v.id === args.versao);
if (!versao) throw Error('Versão inexistente: ' + args.versao);
const library = resolve(process.env.IRH_LIBRARY || join(import.meta.dir, '../library'));
const palavras: { w: string; ini: number; fim: number }[] = JSON.parse(readFileSync(join(library, 'replicacoes', rep.ref, 'transcricao.json'), 'utf8')).palavras;

const ingles = /ingl|english|en-/i.test(rep.idioma_fala), espanhol = /espanh|spanish|es-/i.test(rep.idioma_fala);
const cultura = ingles ? 'en-US' : espanhol ? 'es-ES' : 'pt-BR';
const tmp = mkdtempSync(join(tmpdir(), 'irh-fala-'));
async function sh(cmd: string[]) { const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' }); const [o, e, c] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); if (c) throw Error(e || o); return o; }
let voz = '';
async function sintetizar(texto: string, n: number): Promise<number> {
  const txt = join(tmp, `f${n}.txt`), wav = join(tmp, `f${n}.wav`);
  writeFileSync(txt, texto, 'utf8');
  if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $v=$s.GetInstalledVoices()|?{$_.VoiceInfo.Culture.Name -eq '${cultura}'}|select -First 1; if(-not $v){throw 'Sem voz ${cultura}'}; $s.SelectVoice($v.VoiceInfo.Name); $s.Rate=0; $s.SetOutputToWaveFile('${wav}'); $s.Speak([IO.File]::ReadAllText('${txt}')); $s.Dispose(); $v.VoiceInfo.Name`;
    voz = (await sh(['powershell', '-NoProfile', '-Command', ps])).trim();
  } else {
    await sh(['say', '-o', wav.replace(/\.wav$/, '.aiff'), '-f', txt]); voz = 'macOS say';
    await sh(['ffmpeg', '-v', 'error', '-y', '-i', wav.replace(/\.wav$/, '.aiff'), wav]);
  }
  // Só o trecho falado: corta silêncio do início e do fim antes de medir.
  const limpo = join(tmp, `f${n}.limpo.wav`);
  await sh(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', limpo]);
  return Number((await sh(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', limpo])).trim());
}

try {
  // Calibração: ritmo real da referência contra a mesma fala sintetizada.
  let fonte = 0, sint = 0, n = 0;
  for (const s of rep.shots) {
    const ws = palavras.filter((w) => (w.ini + w.fim) / 2 >= s.janela[0] && (w.ini + w.fim) / 2 < s.janela[1]);
    if (ws.length < 4) continue;
    fonte += ws.at(-1)!.fim - ws[0].ini; sint += await sintetizar(ws.map((w) => w.w).join(' '), n++);
  }
  if (!sint) throw Error('Sem fala na fonte para calibrar o ritmo');
  const fator = fonte / sint;
  const medicoes: Record<string, { segundos: number; fonte: string }> = {};
  const data = new Date().toISOString().slice(0, 10);
  for (const s of rep.shots) {
    // Marcas de falante "[a mãe loira]" não são faladas.
    const fala = String(versao.falas?.[s.id] ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!fala) continue;
    const t = await sintetizar(fala, n++);
    medicoes[s.id] = { segundos: Math.round(t * fator * 1000) / 1000, fonte: `voz sintetizada ${voz} (${cultura}) × ritmo da referência ${fator.toFixed(3)}; medir-fala.ts ${data}` };
  }
  const copy = { ...rep.copy, versoes: rep.copy.versoes.map((v: any) => (v.id === args.versao ? { ...v, medicoes } : v)) };
  await api('/api/replicacoes/' + encodeURIComponent(args.id) + '/config', { method: 'PATCH', body: JSON.stringify({ copy }) });
  console.log(JSON.stringify({ versao: args.versao, voz, fator: Number(fator.toFixed(3)), medicoes: Object.fromEntries(Object.entries(medicoes).map(([k, v]) => [k, v.segundos])) }, null, 1));
} finally { rmSync(tmp, { recursive: true, force: true }); }
