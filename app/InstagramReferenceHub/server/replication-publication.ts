import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { getReplicacao } from './replicacoes';
import { syncPipeline } from './pipeline';
import { HttpError } from './refs';
import { getSettings } from './catalog';
import { now } from './db';
import type { Downloader } from './importer';
import { alvoDaReplicacao, atualizarPost, geridoPelaNota, lerPostsVault } from './posts';

/** Consulta somente o link publicado da replicação; nunca a URL da referência. */
export async function refreshPublication(db: Database, root: string, id: string, downloader: Downloader, postId?: string) {
  const rep = getReplicacao(db, root, id);
  if (rep.slug && geridoPelaNota(rep.slug)) return refreshDoPost(db, root, rep, downloader, postId);
  if (!rep.slug || !rep.postUrl) throw new HttpError(400, 'Anexe o link do post para atualizar as informações.');
  const file = join(root, 'replicacoes', rep.ref, rep.slug, 'flow-producao.json');
  const url = rep.postUrl;
  if (!/^https:\/\/(www\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//.test(url)) throw new HttpError(400, "Link do post inválido");
  let info;
  try { info = await downloader.metrics(url, getSettings({ db, root }).cookies_browser); }
  catch { throw new HttpError(502, 'Não foi possível consultar o post. Os dados anteriores foram preservados; tente atualizar novamente.'); }
  // Releitura evita sobrescrever outra edição ou ressuscitar marcação removida enquanto a consulta rodava.
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  if (cfg.postUrl !== url) throw new HttpError(409, 'O link foi alterado durante a consulta. Atualize novamente.');
  const published = info.published_at && Number.isFinite(Date.parse(info.published_at)) ? new Date(info.published_at).toISOString() : null;
  const metric = (v: number | null) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  cfg.publicacaoInfo = { url, coletadoEm: now(), fonte: 'yt-dlp', publicadoEm: published,
    perfil: info.username, legenda: info.caption, views: metric(info.views), likes: metric(info.likes), comments: metric(info.comments) };
  if (published && cfg.postadoEmFonte !== 'manual') { cfg.postadoEm = published; cfg.postadoEmFonte = 'link'; }
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  syncPipeline(db, root, { ref: rep.ref, origem: 'replicacao' });
  return getReplicacao(db, root, rep.id);
}

/** Perfil com Postagens.md: o link é do POST (variação). Métricas ficam no flow-producao.json por post; a data real vai para a nota. */
async function refreshDoPost(db: Database, root: string, rep: ReturnType<typeof getReplicacao>, downloader: Downloader, postId?: string) {
  const p = alvoDaReplicacao(db, root, rep.id, postId, 'postado');
  if (!p?.url) throw new HttpError(400, 'Anexe o link do post para atualizar as informações.');
  let info;
  try { info = await downloader.metrics(p.url, getSettings({ db, root }).cookies_browser); }
  catch { throw new HttpError(502, 'Não foi possível consultar o post. Os dados anteriores foram preservados; tente atualizar novamente.'); }
  const atual = lerPostsVault(root).find(x => x.id === p.id);
  if (!atual || atual.publicacao !== 'postado' || atual.url !== p.url) throw new HttpError(409, 'A publicação mudou durante a consulta. Atualize novamente.');
  const file = join(root, 'replicacoes', rep.ref, rep.slug!, 'flow-producao.json');
  let cfg: any = {};
  try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { cfg = { schema: 1 }; }
  const published = info.published_at && Number.isFinite(Date.parse(info.published_at)) ? new Date(info.published_at).toISOString() : null;
  const metric = (v: number | null) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  cfg.publicacoes = { ...(cfg.publicacoes ?? {}), [p.id]: { url: p.url, coletadoEm: now(), fonte: 'yt-dlp', publicadoEm: published,
    perfil: info.username, legenda: info.caption, views: metric(info.views), likes: metric(info.likes), comments: metric(info.comments) } };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  if (published && !atual.postado_em) atualizarPost(p.id, { postado_em: published });
  syncPipeline(db, root, { ref: rep.ref, origem: 'replicacao' });
  return getReplicacao(db, root, rep.id);
}
