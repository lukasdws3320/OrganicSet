import { readFileSync } from 'node:fs';

/** CLI is a client, not a second workflow. The running API owns all mutations. */
const [command,...args]=process.argv.slice(2);
const flags:Record<string,string>={};
try{
  for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('Use --opcao valor');flags[args[i].slice(2)]=args[i+1];}
  const allowed=['base','ref','expert','experts','id','url','formato','engine','alteracoes-file','assinatura','identidade','gerador','creditos','gerar','editor','item','motivo','arquivo','nova-versao','itens','autorizacao','duracao','modelo'];
  for(const key of Object.keys(flags))if(!allowed.includes(key))throw Error('Opção desconhecida: --'+key);
  const base=new URL(flags.base||process.env.IRH_URL||'http://127.0.0.1:4317');
  if(!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.protocol!=='http:')throw Error('A CLI usa a API local; informe uma URL http de localhost');
  const agente=process.env.IRH_AGENTE||(process.env.CLAUDECODE?'Claude Code':Object.keys(process.env).some(k=>k.startsWith('CODEX_'))?'Codex':'CLI');
  const required=(key:string)=>{if(!flags[key])throw Error('Informe --'+key);return flags[key];};
  const request=async(path:string,body?:unknown)=>{
    const res=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{'X-IRH-Agente':agente,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
    const data=await res.json() as any;if(!res.ok)throw Error(data.error||JSON.stringify(data));return data;
  };
  let result:unknown;
  switch(command){
    case 'contexto': result=await request('/api/execucao?'+new URLSearchParams({...(flags.ref?{ref:flags.ref}:{}),...(flags.expert?{expert:flags.expert}:{})}));break;
    case 'importar': {
      const c:any=flags.expert?await request('/api/execucao?expert='+encodeURIComponent(flags.expert)):null;
      // Link do Google Drive: o Hub baixa com a sessão do Chrome de geração e registra como upload (sem fila de links).
      const drive=/^https?:\/\/(drive|docs)\.google\.com\/|^https?:\/\/drive\.usercontent\.google\.com\//i.test(required('url'));
      result=await request(drive?'/api/import/drive':'/api/import',drive?{url:flags.url,...(c?{clients:String(c.expert.id)}:{})}:{urls:[required('url')],...(c?{clients:[c.expert.id]}:{})});break;
    }
    case 'importacao': result=await request('/api/import/jobs/'+encodeURIComponent(required('id')));break;
    case 'preparar': {
      const experts=(flags.experts??required('expert')).split(',').map(s=>s.trim()).filter(Boolean);
      const results=[];for(const expert of [...new Set(experts)]){
      const c:any=await request('/api/execucao?expert='+encodeURIComponent(expert)+'&ref='+encodeURIComponent(required('ref')));
      if(c.reference.kind!=='video')throw Error('Carrossel usa pacote-chat; preparação de vídeo exige vídeo');
      results.push(await request('/api/replicacoes',{ref:c.reference.id,expert_id:c.expert.id,...(flags.formato?{formato:flags.formato}:{}),engine:flags.engine||'Veo 3'}));}result=results.length===1?results[0]:results;break;
    }
    case 'status': result=await request('/api/replicacoes/'+encodeURIComponent(required('id')));break;
    case 'producao': result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/producao');break;
    case 'executar': {
      // Consulta só quando nada foi pedido: --gerar ou --creditos sem efeito pareceriam autorização concedida.
      if(flags.gerar&&!['sim','nao'].includes(flags.gerar))throw Error('Use --gerar sim ou --gerar nao');
      const creditos=flags.creditos===undefined?undefined:Number(flags.creditos);if(creditos!==undefined&&!Number.isFinite(creditos))throw Error('--creditos precisa ser um número');
      if(creditos!==undefined&&!flags.gerar&&!flags.gerador)throw Error('--creditos só vale junto de --gerar ou --gerador');
      const pedido=flags.gerador||flags.gerar||flags['nova-versao'];
      result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao',pedido?{provider:flags.gerador,maxCredits:creditos,authorized:flags.gerar==='sim',editing:flags.editor||'ffmpeg',...(flags['nova-versao']==='sim'?{newVersion:true}:{})}:undefined);break;
    }
    case 'trocar-modelo':result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/modelo',{modelo:required('modelo'),autorizacao:required('autorizacao'),motivo:required('motivo')});break;
    case 'coletar':result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/coletar',{});break;
    case 'autorizar-tentativa':result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/'+encodeURIComponent(required('item'))+'/tentativa',{motivo:required('motivo'),autorizacao:required('autorizacao'),...(flags.duracao?{duracao:Number(flags.duracao)}:{})});break;
    case 'aprovar-imagem':if(required('item').includes(',')){result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/aprovar',{itens:flags.item});break;}
    case 'reprovar-imagem':result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/'+encodeURIComponent(required('item'))+'/decisao',{approved:command==='aprovar-imagem',reason:flags.motivo||''});break;
    case 'atualizar-prompts':result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/prompts',{itens:required('itens')});break;
    case 'reenviar-item':result=await request('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/'+encodeURIComponent(required('item'))+'/reenviar',{motivo:required('motivo')});break;
    case 'receber-imagem': {
      const response=await fetch(new URL('/api/replicacoes/'+encodeURIComponent(required('id'))+'/execucao/'+encodeURIComponent(required('item'))+'/imagem',base),{method:'POST',headers:{'X-IRH-Agente':agente},body:readFileSync(required('arquivo'))});const r:any=await response.json();if(!response.ok)throw Error(r.error);result=r;break;
    }
    case 'pacote-chat': result=await request('/api/refs/'+encodeURIComponent(required('ref'))+'/pacote-chat',{expert:required('expert'),identityMode:flags.identidade,alteracoes:flags['alteracoes-file']?readFileSync(flags['alteracoes-file'],'utf8'):'',assinatura:flags.assinatura});break;
    case 'ajuda': case '--help': case undefined:
      result={commands:{contexto:'[--ref REF] [--expert SLUG]',importar:'--url URL [--expert SLUG]',importacao:'--id JOB',preparar:'--ref REF --expert SLUG ou --experts SLUG,SLUG [--formato FORMATO] [--engine ENGINE]',status:'--id REF--SLUG',producao:'--id REF--SLUG',executar:'--id REF--SLUG [--gerador manual|chatgpt|flow] [--creditos LIMITE] [--gerar sim|nao] [--editor ffmpeg|opencut] [--nova-versao sim]',coletar:'--id REF--SLUG','aprovar-imagem':'--id REF--SLUG --item STILL01[,STILL02]','atualizar-prompts':'--id REF--SLUG --itens STILL01,STILL02','autorizar-tentativa':'--id REF--SLUG --item ITEM --motivo TEXTO --autorizacao "quem autorizou e quando" [--duracao 4|6|8]','reprovar-imagem':'--id REF--SLUG --item STILL01 --motivo TEXTO','reenviar-item':'--id REF--SLUG --item ITEM --motivo EVIDENCIA','receber-imagem':'--id REF--SLUG --item STILL01 --arquivo /imagem.png','pacote-chat':'--ref REF --expert SLUG [--alteracoes-file ARQUIVO] [--assinatura @perfil]'},base:'--base http://127.0.0.1:4317 ou IRH_URL',note:'Preparar não gera. Executar com --gerar sim autoriza a produção dentro do teto; sem opções consulta o estado, os prompts integrais e nextAction. Coletar nunca gera.'};break;
    default:throw Error('Comando desconhecido; use ajuda');
  }
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error(JSON.stringify({error:(e as Error).message}));process.exitCode=1;}
