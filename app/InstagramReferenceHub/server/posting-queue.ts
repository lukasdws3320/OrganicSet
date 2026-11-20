import type { PostItem } from './posts';
export type PostingItem = PostItem & { bloqueio: string | null };
export type PostingProfile = { slug: string; name: string; handle: string | null; posts: PostingItem[] };
export type PostingBlock = { id: string; data: string; hora: string; perfis: PostingProfile[]; total: number; postados: number; pendentes: number };
export function montarFilaPostagem(posts: PostItem[], opts: { agora?: Date; dia?: string; profile?: string | null } = {}) {
  const agora = opts.agora ?? new Date();
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(agora);
  const parte = (k: string) => partes.find(p => p.type === k)!.value;
  const hoje = `${parte('year')}-${parte('month')}-${parte('day')}`;
  const horaAgora = `${parte('hour')}:${parte('minute')}`;
  const dia = opts.dia ?? hoje;
  const itens: PostingItem[] = posts.filter(p => p.publicacao !== 'arquivado' && (!opts.profile || p.perfil.slug === opts.profile)).map(p => ({ ...p, bloqueio: p.stage === 'producao' || !(p.video || p.slides.length) ? 'Arquivo final ainda não disponível' : null }));
  const blocosMap = new Map<string, PostingBlock>();
  for (const p of itens) {
    if (!p.data || !p.hora) continue;
    const id = `${p.data}T${p.hora}`;
    const b = blocosMap.get(id) ?? { id, data: p.data, hora: p.hora, perfis: [], total: 0, postados: 0, pendentes: 0 };
    let perfil = b.perfis.find(x => x.slug === p.perfil.slug);
    if (!perfil) { perfil = { ...p.perfil, posts: [] }; b.perfis.push(perfil); }
    perfil.posts.push(p); b.total++; p.publicacao === 'postado' ? b.postados++ : b.pendentes++;
    blocosMap.set(id, b);
  }
  const todos = [...blocosMap.values()].sort((a,b) => a.id.localeCompare(b.id));
  for (const b of todos) b.perfis.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
  const blocos = todos.filter(b => b.data === dia);
  const abertos = blocos.filter(b => b.pendentes);
  const atual = dia === hoje ? abertos.find(b => b.hora <= horaAgora)?.id ?? null : null;
  const proximo = todos.find(b => b.pendentes && b.id > `${dia}T${dia === hoje ? horaAgora : '00:00'}`) ?? null;
  const doDia = itens.filter(p => p.data === dia);
  return { dia, hoje, hora: horaAgora, lido_em: agora.toISOString(), blocos, atual, proximo,
    futuros: todos.filter(b=>b.data>dia && b.pendentes),
    total: doDia.length, postados: doDia.filter(p=>p.publicacao==='postado').length,
    bloqueados: doDia.filter(p=>p.publicacao!=='postado' && p.bloqueio).length,
    sem_horario: itens.filter(p=>p.publicacao!=='postado' && (!p.data || (p.data===dia && !p.hora))),
    atrasados: todos.filter(b=>b.data<dia && b.pendentes).map(b=>({ ...b, posts:b.perfis.flatMap(p=>p.posts).filter(p=>p.publicacao!=='postado') })),
  };
}
export type PostingQueue = ReturnType<typeof montarFilaPostagem>;

/** Avanço da sessão considera todos os blocos pendentes, inclusive vencidos. */
export function proximoBlocoPendente(q: PostingQueue, selecionado?: string, profile?: string) {
  return [...q.atrasados, ...q.blocos, ...q.futuros]
    .filter(b=>b.id!==selecionado && b.perfis.some(p=>(!profile || p.slug===profile) && p.posts.some(x=>x.publicacao!=='postado')))
    .sort((a,b)=>a.id.localeCompare(b.id))[0] ?? null;
}
