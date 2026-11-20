import { Check, Copy, FolderOpen, RefreshCw, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { proximoBlocoPendente } from '../../../server/posting-queue';
import type { PostingBlock, PostingItem, PostingQueue } from '../../../server/posting-queue';
import { api, invalidate, navigate, useApi } from '../lib';
import { Button, cx, ErrorState } from '../ui';

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function Postar() {
  const [dia, setDia] = useState(hoje);
  const [perfil, setPerfil] = useState('');
  const resp = useApi<PostingQueue>(`/api/postagem/fila?dia=${dia}`);
  const [blocoId, setBloco] = useState<string | null>(null);
  const [postId, setPost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const horariosRef = useRef<HTMLDivElement>(null);
  const filaRef = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ultimo, setUltimo] = useState<PostingItem | null>(null);
  const [url, setUrl] = useState('');
  const [slide, setSlide] = useState(0);
  const [recebidos, setRecebidos] = useState<Set<string>>(new Set());
  useEffect(()=>{ if(resp.data) setRecebidos(prev=>new Set([...prev].filter(id=>!resp.data!.blocos.flatMap(b=>b.perfis.flatMap(p=>p.posts)).some(p=>p.id===id && p.publicacao==='postado')))); },[resp.data]);
  const q = resp.data;
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') resp.reload(); }, 30000);
    window.addEventListener('focus', resp.reload);
    return () => { clearInterval(timer); window.removeEventListener('focus', resp.reload); };
  }, [resp.reload]);
  const blocos = q?.blocos ?? [];
  // O bloco fica selecionado ao terminar. O próximo horário exige um clique explícito.
  const bloco = blocos.find(b=>b.id===blocoId) ?? blocos.find(b=>b.id===q?.atual) ?? blocos.find(b=>b.pendentes) ?? blocos[0];
  const visiveis = (bloco?.perfis ?? []).filter(p=>!perfil || p.slug===perfil).map(p=>({...p,posts:p.posts.map(x=>recebidos.has(x.id) ? {...x,publicacao:'postado' as const} : x)}));
  const posts = visiveis.flatMap(p=>p.posts);
  const atual = posts.find(p=>p.id===postId) ?? posts.find(p=>p.publicacao!=='postado');
  useEffect(()=>{ setUrl(''); setSlide(0); setErro(''); },[atual?.id]);
  useEffect(()=>{
    const mostrar = (container: HTMLDivElement | null, seletor: string) => {
      const item = container?.querySelector<HTMLElement>(seletor);
      if (!container || !item || container.scrollWidth <= container.clientWidth) return;
      const c = container.getBoundingClientRect(), r = item.getBoundingClientRect();
      container.scrollTo({ left: container.scrollLeft + r.left - c.left - (c.width-r.width)/2 });
    };
    mostrar(horariosRef.current, '[aria-pressed="true"]');
    mostrar(filaRef.current, '[aria-current="step"]');
  },[bloco?.id,atual?.id]);
  const mudarDia = (v:string) => { if(!v)return; setAviso('');setDia(v);setBloco(null);setPost(null);setPerfil(''); };
  async function acao(fn:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setErro('');setAviso('');
    try { await fn(); } catch(e) { setErro(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { lock.current=false;setBusy(false); }
  }
  async function confirmar() {
    if(!atual || atual.bloqueio)return;
    const p=atual;
    await api(`/api/posts/${encodeURIComponent(p.id)}`,{method:'PATCH',json:{publicacao:'postado',postado_em:new Date().toISOString(),...(url.trim()?{url:url.trim()}:{})}});
    setUltimo(p);setRecebidos(ids=>new Set([...ids,p.id]));
    setUrl('');
    // Mantém o perfil até esgotá-lo, depois segue para o próximo perfil deste horário.
    const abertos=posts.filter(x=>x.id!==p.id && x.publicacao!=='postado');
    const proximo=abertos.find(x=>x.perfil.slug===p.perfil.slug) ?? abertos[0];
    setBloco(bloco!.id);setPost(proximo?.id ?? null);
    setAviso(proximo ? `Postado. Próximo: ${proximo.perfil.handle ? '@'+proximo.perfil.handle.replace(/^@/,'') : proximo.perfil.name}.` : 'Horário concluído. Escolha o próximo bloco quando for postar.');
    invalidate();resp.reload();
  }
  if(!q) return <div className="space-y-5"><div className="flex items-center gap-2"><label className="sr-only" htmlFor="posting-day">Dia da postagem</label><input id="posting-day" type="date" value={dia} onChange={e=>mudarDia(e.target.value)} className="h-10 rounded-r2 border border-line-2 bg-card px-3 text-sm text-ink"/><Button variant="secondary" onClick={()=>mudarDia(hoje())}>Hoje</Button></div>{resp.error ? <ErrorState title="Não deu para carregar a fila" detail={resp.error} onRetry={resp.reload}/> : <p role="status">Carregando posts…</p>}</div>;
  const slideAtual = Math.min(slide, Math.max(0,(atual?.slides.length ?? 0)-1));
  const proximo = proximoBlocoPendente(q, bloco?.id, perfil);
  const perfis=[...new Map(blocos.flatMap(b=>b.perfis).map(p=>[p.slug,p])).values()];
  const selecionar=(b:PostingBlock)=>{setBloco(b.id);setPost(null);setAviso('');};
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
      <div className="min-w-0"><p className="eyebrow mb-1.5">Publicação</p><h1 className="title-serif text-[30px] sm:text-[36px]">Hora de <em>postar</em></h1><p className="mt-1.5 text-[13px] text-ink-2">Seu horário, seus perfis. Um post de cada vez.</p></div>
      <div className="flex w-full items-center gap-2 sm:w-auto"><label className="sr-only" htmlFor="posting-day">Dia da postagem</label><input id="posting-day" type="date" disabled={busy} value={dia} onChange={e=>mudarDia(e.target.value)} className="h-10 min-w-0 flex-1 rounded-r2 border border-line-2 bg-card px-3 text-sm text-ink sm:flex-none"/><Button variant="secondary" disabled={busy} onClick={()=>mudarDia(hoje())}>Hoje</Button><Button variant="ghost" disabled={busy || resp.loading} onClick={resp.reload} aria-label="Atualizar fila" icon={<RefreshCw size={16} strokeWidth={1.5}/>}/></div>
    </header>
    <section className="space-y-4" aria-label="Agenda de postagem">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><span className="num text-sm font-medium">{q.postados}<span className="text-ink-3">/{q.total}</span></span><span className="text-[13px] text-ink-2">postados no dia</span><span className="hidden h-4 w-px bg-line sm:block"/><span className="hidden text-[12px] text-ink-3 sm:block">{q.total-q.postados} restantes{q.bloqueados>0 ? ` · ${q.bloqueados} sem arquivo` : ''}</span></div>
        <label className="flex max-w-full items-center gap-2 text-xs text-ink-3"><span className="sr-only sm:not-sr-only">Perfil</span><select aria-label="Filtrar perfil" disabled={busy} value={perfil} onChange={e=>{setPerfil(e.target.value);setPost(null);setAviso('');}} className="h-10 min-w-0 max-w-[220px] rounded-r2 border border-line bg-card px-3 text-[13px] text-ink"><option value="">Todos os perfis</option>{perfis.map(p=><option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
      </div>
      <div ref={horariosRef} className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-3" aria-label="Horários do dia">{blocos.map(b=><button key={b.id} disabled={busy} onClick={()=>selecionar(b)} aria-pressed={bloco?.id===b.id} className={cx('flex min-h-[68px] min-w-[104px] shrink-0 flex-col justify-center gap-1 rounded-r2 border px-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',bloco?.id===b.id?'border-ink bg-ink text-paper':'border-line bg-card text-ink hover:border-ink-3')}><span className="num text-[17px] font-medium">{b.hora}</span><span className="text-[11px] opacity-70">{b.pendentes ? `${b.total-b.postados} a postar` : '✓ Concluído'}</span></button>)}</div>
    </section>
    {resp.error && <p role="alert" className="rounded-r2 border border-line bg-sunken p-3 text-sm">Falha ao atualizar: {resp.error}. Exibindo a última leitura.</p>}
    {ultimo && <div className="flex items-center gap-3 rounded-r2 border border-line bg-card px-4 py-2 text-[13px]"><Check size={16} className="shrink-0"/><span className="min-w-0 flex-1 truncate">Postado: {ultimo.titulo}</span><Button variant="ghost" size="sm" disabled={busy} icon={<Undo2 size={14}/>} onClick={()=>acao(async()=>{await api(`/api/posts/${encodeURIComponent(ultimo.id)}`,{method:'PATCH',json:{publicacao:'a_publicar'}});setBloco(`${ultimo.data}T${ultimo.hora}`);setPost(ultimo.id);setUltimo(null);setRecebidos(ids=>new Set([...ids].filter(id=>id!==ultimo.id)));invalidate();resp.reload();})}>Desfazer</Button></div>}
    {erro && <p role="alert" className="rounded-r2 border border-line bg-sunken p-3 text-sm">{erro}</p>}
    <div role="status" aria-live="polite" className={aviso ? 'rounded-r2 bg-sunken px-4 py-3 text-[13px] text-ink-2' : 'sr-only'}>{aviso}</div>
    <div className="grid items-start gap-5 min-[1180px]:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="min-w-0"><div className="mb-3 flex items-center justify-between"><h2 className="eyebrow">{bloco ? `${bloco.hora} · perfis` : 'Agenda do dia'}</h2><span className="num text-xs text-ink-3">{posts.filter(p=>p.publicacao!=='postado').length} restantes</span></div><div ref={filaRef} className="flex gap-3 overflow-x-auto pb-2 min-[1180px]:flex-col min-[1180px]:overflow-visible min-[1180px]:pb-0">{visiveis.map(p=><section key={p.slug} className="w-[260px] shrink-0 overflow-hidden rounded-r2 border border-line bg-card min-[1180px]:w-full"><div className="flex items-center gap-2 border-b border-line px-3 py-3"><div className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-medium">{p.handle?'@'+p.handle.replace(/^@/,''):p.name}</strong><p className="mt-0.5 hidden truncate text-[11px] text-ink-3 min-[1180px]:block">{p.name}</p></div><span className="num shrink-0 text-[11px] text-ink-3">{p.posts.filter(x=>x.publicacao==='postado').length}/{p.posts.length}</span></div>{p.posts.map(x=><button key={x.id} disabled={busy} onClick={()=>{setPost(x.id);setAviso('');}} aria-current={atual?.id===x.id?'step':undefined} className={cx('block w-full border-b border-line px-3 py-3 text-left transition-colors last:border-0 hover:bg-sunken',atual?.id===x.id && 'bg-sunken shadow-[inset_3px_0_0_var(--color-ink)]')}><span className="flex items-center gap-2 text-[11px] text-ink-3"><span>{x.publicacao==='postado'?'✓ Postado':x.bloqueio?'Sem arquivo':'A postar'}</span>{x.versao && <span className="rounded-r1 border border-line px-1.5 py-0.5 num">{x.versao}</span>}{x.canal && <span className="truncate">{x.canal}</span>}</span><span className="mt-1.5 line-clamp-1 text-[13px] leading-snug min-[1180px]:line-clamp-2">{x.titulo}</span></button>)}</section>)}</div></aside>
      <section className="min-w-0 overflow-hidden rounded-r2 border border-line bg-card">{atual ? <>
        <header className="border-b border-line px-4 py-4 sm:px-5"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"><strong className="break-all font-medium">{atual.perfil.handle?'@'+atual.perfil.handle.replace(/^@/,''):atual.perfil.name}</strong>{atual.canal && <span className="text-ink-3">{atual.canal}</span>}{atual.versao && <span className="num rounded-r1 border border-line px-1.5 py-0.5 text-[10px] text-ink-2">{atual.versao}</span>}{atual.personagem_nome && <span className="text-ink-3">{atual.personagem_nome}</span>}</div><h2 className="mt-2 break-words text-[17px] font-medium leading-snug">{atual.titulo}</h2></header>
        <div className="grid items-start gap-5 p-4 sm:grid-cols-[minmax(180px,240px)_minmax(0,1fr)] sm:p-5">
          <div className="min-w-0"><div className="mx-auto flex aspect-[9/16] max-h-[390px] max-w-full items-center justify-center overflow-hidden rounded-r2 bg-black">
          {atual.video ? <video key={atual.id} src={atual.video} controls preload="metadata" className="h-full w-full object-contain" onError={()=>setErro('O vídeo não pôde ser aberto. Confira o arquivo final no estúdio.')}/> : atual.slides.length ? <img src={atual.slides[slideAtual]} alt={`Slide ${slideAtual+1}`} className="h-full w-full object-contain"/> : <p className="p-5 text-center text-sm text-white/70">Arquivo final ainda não disponível.</p>}</div>
          {!atual.video && atual.slides.length>0 && <div className="mt-2 flex items-center justify-between"><Button variant="ghost" aria-label="Slide anterior" disabled={!slideAtual} onClick={()=>setSlide(slideAtual-1)}>←</Button><span className="num text-xs text-ink-3">{slideAtual+1}/{atual.slides.length}</span><Button variant="ghost" aria-label="Próximo slide" disabled={slideAtual>=atual.slides.length-1} onClick={()=>setSlide(slideAtual+1)}>→</Button></div>}
          <Button className="mt-3 w-full" variant="secondary" icon={<FolderOpen size={16} strokeWidth={1.5}/>} disabled={busy || !!atual.bloqueio} onClick={()=>acao(async()=>{await api(`/api/posts/${encodeURIComponent(atual.id)}/revelar`,{method:'POST'});setAviso('Arquivo aberto no Finder. Envie para o celular e publique no perfil indicado.');})}>Abrir no Finder</Button>
          {atual.hub_url && <button className="mt-1 flex min-h-10 w-full items-center justify-center text-xs text-ink-3 underline underline-offset-4 hover:text-ink" onClick={()=>navigate(atual.hub_url!)}>Ver no estúdio</button>}
          </div>
          <div className="min-w-0"><div className="flex min-h-10 items-center justify-between gap-3"><h3 className="text-[13px] font-medium">Legenda</h3><Button variant="secondary" size="sm" icon={<Copy size={14} strokeWidth={1.5}/>} disabled={!atual.legenda || busy} onClick={()=>acao(async()=>{await navigator.clipboard.writeText(atual.legenda!);setAviso('Legenda copiada.');})}>Copiar</Button></div>
          {atual.legenda_fonte==='referencia' && <p className="mt-2 rounded-r1 bg-sunken px-3 py-2 text-xs text-ink-2">Legenda da referência: falta adaptar.</p>}
          <pre className="mt-2 max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words rounded-r2 border border-line bg-paper p-3 font-sans text-[13px] leading-relaxed [overflow-wrap:anywhere]">{atual.legenda || 'Sem legenda cadastrada para este post.'}</pre>
          <details className="mt-4"><summary className="cursor-pointer py-1 text-xs text-ink-3">Adicionar link da publicação <span className="opacity-70">· opcional</span></summary><label className="sr-only" htmlFor="posting-url">Link da publicação</label><input id="posting-url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="instagram.com/reel/…" className="mt-2 h-10 w-full min-w-0 rounded-r2 border border-line bg-paper px-3 text-[13px] text-ink"/></details>
          {atual.bloqueio && <p className="mt-3 text-xs text-ink-2">{atual.bloqueio}. Conclua a produção no estúdio.</p>}
          <div className="mt-4 border-t border-line pt-4"><Button className="w-full" variant="accent" icon={<Check size={17}/>} disabled={busy || !!atual.bloqueio || atual.publicacao==='postado'} onClick={()=>acao(confirmar)}>{busy?'Salvando…':atual.publicacao==='postado'?'Já postado':'Postei · próximo'}</Button><p className="mt-2 text-[11px] leading-relaxed text-ink-3">Confirme após publicar no Instagram. O próximo post aparece aqui.</p></div>
          </div>
        </div>
      </> : <div className="px-5 py-16 text-center"><Check size={24} strokeWidth={1.5} className="mx-auto mb-4 text-ink-3"/><h2 className="text-lg font-medium">{bloco && !visiveis.length ? 'Este perfil não tem posts neste horário' : bloco ? 'Tudo concluído neste horário' : 'Sem posts neste dia'}</h2><p className="mt-2 text-[13px] text-ink-2">{proximo ? `Próximo horário com posts: ${proximo.data.split('-').reverse().join('/')} às ${proximo.hora}.` : 'Nenhum próximo horário com posts agendados.'}</p>{proximo && <Button className="mt-5" variant="secondary" onClick={()=>{if(proximo!.data!==dia)mudarDia(proximo!.data);setBloco(proximo!.id);setPost(null);}}>Ver próximo horário</Button>}</div>}</section>
    </div>
    {(q.atrasados.length>0 || q.sem_horario.length>0) && <details className="rounded-r2 border border-line px-4 py-3"><summary className="cursor-pointer text-[13px] text-ink-2">Outras pendências · {q.atrasados.reduce((n,b)=>n+b.posts.length,0)} anteriores · {q.sem_horario.length} sem horário</summary><div className="mt-4 space-y-3">{q.atrasados.map(b=><button key={b.id} disabled={busy} className="block min-h-10 text-sm underline" onClick={()=>{mudarDia(b.data);setBloco(b.id);}}>{b.data.split('-').reverse().join('/')} · {b.hora} · {b.posts.length} pendentes</button>)}{q.sem_horario.map(p=><p key={p.id} className="text-sm">{p.perfil.name} · {p.titulo} {p.hub_url && <button className="underline" onClick={()=>navigate(p.hub_url!)}>Organizar no estúdio</button>}</p>)}</div></details>}
  </div>;
}
