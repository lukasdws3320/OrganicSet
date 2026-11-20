import {createHash,randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {appendFileSync,copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,writeFileSync,statSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {adaptImagePrompt} from './prompt-factory';

export type Provider='manual'|'chatgpt'|'flow';
export type JobStatus='queued'|'running'|'submitted'|'uncertain'|'error'|'pending_review'|'accepted'|'waiting_image'|'waiting_shared'|'available';
export type Job={id:string;kind:'image'|'video';provider:Provider|'veo';prompt:string;basePrompt:string;toolPrompts?:{chatgpt:string;nanobanana:string};attempt:number;status:JobStatus;inputs:{path:string;sha256:string;role:string}[];dependency?:string;token?:string;output?:string;sha256?:string;error?:string;receipt?:any;history:any[];decision?:{approved:boolean;reason:string;at:string;reusedFrom?:string};executionPlan?:string;recoveryStartedAt?:string;sharedFrom?:{runId:string;slug:string;job:string;file:string;sha256:string;at:string};retryCollection?:boolean;collectionError?:{message:string;at:string;terminal:boolean};sharedWait?:{runId:string;slug:string;job:string}};
export type Workflow={schema:'irh-production-workflow/v1';runId:string;ref:string;slug:string;provider:Provider;authorized:boolean;editing:'ffmpeg'|'opencut';renamedFrom?:{slug:string;at:string;replicationSha256?:string;expertProfileSha256?:string};createdAt:string;updatedAt:string;plan:any;jobs:Job[];events:{at:string;action:string;item?:string}[]};
const filename=(dir:string)=>join(dir,'producao-workflow.json');
// Quem pediu a ação (Claude Code, Codex, Interface); sem pedido em andamento, é a própria fila.
const actor=new AsyncLocalStorage<string>();
export const withActor=<T>(name:string|null|undefined,run:()=>T)=>actor.run(name||'Interface',run);
const registroFile=(dir:string)=>join(dir,'REGISTRO.md');
function registrar(dir:string,w:Workflow,action:string,item?:string){
 const file=registroFile(dir),j=item?w.jobs.find(x=>x.id===item):undefined;
 if(!existsSync(file))writeFileSync(file,`# Registro de execução · ${w.ref} · ${w.slug}\n\nEscrito pelo backend a cada mudança; o Hub só mostra. Estado completo em producao-workflow.json.\n\n`);
 appendFileSync(file,`- ${w.updatedAt} · run ${w.runId.slice(0,8)} · ${w.provider} · ${action}${item?' · '+item:''}${j?` · tentativa ${j.attempt} · ${j.status}`:''} · por ${actor.getStore()??'Fila do Hub'}${j?.sha256?' · sha256 '+j.sha256.slice(0,12):''}${j?.error?' · erro: '+j.error.replace(/\s+/g,' ').slice(0,300):''}\n`);
}
export const fileHash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
// Só para exibir estado nas listagens: não relê o vídeo inteiro se tamanho e data não mudaram. Travas de produção usam fileHash.
const hashes=new Map<string,{size:number;mtime:number;hash:string}>();
export function fileHashCached(file:string){const st=statSync(file),c=hashes.get(file);if(c&&c.size===st.size&&c.mtime===st.mtimeMs)return c.hash;const hash=fileHash(file);hashes.set(file,{size:st.size,mtime:st.mtimeMs,hash});return hash;}
const now=()=>new Date().toISOString();
export function readWorkflow(dir:string):Workflow|null{return existsSync(filename(dir))?JSON.parse(readFileSync(filename(dir),'utf8')):null;}
function save(dir:string,w:Workflow,action:string,item?:string){w.updatedAt=now();w.events.push({at:w.updatedAt,action,item,actor:actor.getStore()??'Fila do Hub'} as any);registrar(dir,w,action,item);mkdirSync(dir,{recursive:true});const tmp=filename(dir)+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(w,null,2)+'\n');renameSync(tmp,filename(dir));writeFileSync(join(dir,'PROMPTS-PRODUCAO.txt'),w.jobs.map(j=>`${j.id} · ${j.kind==='image'?'IMAGEM':'VÍDEO'} · tentativa ${j.attempt}\n${j.inputs.map((a,i)=>`Anexo ${i+1}: ${a.path} (${a.role})`).join('\n')}\n${j.prompt}`).join('\n\n'));return w;}
function requireWorkflow(dir:string){const w=readWorkflow(dir);if(!w)throw Error('Produção ainda não iniciada');return w;}
function job(w:Workflow,id:string,kind?:Job['kind']){const j=w.jobs.find(x=>x.id===id&&(!kind||x.kind===kind));if(!j)throw Error('Item de produção inexistente');return j;}
export function createWorkflow(dir:string,plan:any,options:{provider:Provider;authorized:boolean;editing:'ffmpeg'|'opencut'}){
 const old=readWorkflow(dir);if(old){if(old.ref!==plan.ref||old.slug!==plan.identity?.expertSlug||old.provider!==options.provider||JSON.stringify(old.plan)!==JSON.stringify(plan))throw Error('Produção existente: retome a fila; uma nova versão precisa de outro diretório');return old;}
 if(!['manual','chatgpt','flow'].includes(options.provider)||!['ffmpeg','opencut'].includes(options.editing))throw Error('Escolha gerador de imagem e editor');
 if(!/^REF-\d{4}-\d{2}-\d{4}$/.test(plan.ref)||!/^[a-z0-9-]+$/.test(plan.identity?.expertSlug??'')||!plan.stills?.length||!plan.shots?.length)throw Error('Plano de produção incompleto');
 const ids=[...plan.stills,...plan.shots].map((x:any)=>x.id);if(new Set(ids).size!==ids.length||ids.some((id:string)=>! /^(?:STILL|SHOT)\d+$/.test(id)))throw Error('IDs de produção inválidos');
 const images:Job[]=plan.stills.map((s:any)=>{
  const inputs=s.inputs.map((id:string)=>{const a=plan.assets.find((x:any)=>x.id===id);if(!a)throw Error('Anexo de imagem ausente');const sha256=fileHash(a.path);if(a.sha256&&a.sha256!==sha256)throw Error('Anexo de imagem alterado');return {path:a.path,sha256,role:a.role};});
  const attachments=inputs.map((a:Job['inputs'][number])=>({file:a.path,role:(/contact|identidade/i.test(a.role)?'identity':'frame') as 'frame'|'identity'}));
  const toolPrompts={chatgpt:adaptImagePrompt(s.prompt,attachments,'chatgpt'),nanobanana:adaptImagePrompt(s.prompt,attachments,'nanobanana')};
  const prompt=options.provider==='chatgpt'?toolPrompts.chatgpt:s.prompt.replace(/\s*Nomeie a imagem gerada com o nome → [^\s]+\./,'');
  return {id:s.id,kind:'image',provider:options.provider,prompt,basePrompt:prompt,toolPrompts,attempt:1,status:'queued',inputs,history:[]};
 });
 const videos:Job[]=plan.shots.map((s:any)=>{if(!images.some(i=>i.id===s.still))throw Error('Shot sem imagem inicial');return {id:s.id,kind:'video',provider:'veo',prompt:s.prompt,basePrompt:s.prompt,attempt:1,status:'waiting_image',dependency:s.still,inputs:[],history:[]};});
 return save(dir,{schema:'irh-production-workflow/v1',runId:randomUUID(),ref:plan.ref,slug:plan.identity.expertSlug,...options,createdAt:now(),updatedAt:now(),plan,jobs:[...images,...videos],events:[]},'created');
}
// Nova versão pedida com outro gerador: a anterior e seus clipes ficam intactos em producao/<run>/.
export function archiveWorkflow(dir:string){
 const w=requireWorkflow(dir);if(w.jobs.some(j=>['running','submitted','uncertain'].includes(j.status)))throw Error('Há envios em andamento nesta produção; colete antes de abrir outra versão');
 save(dir,w,'version_archived');const folder=join(dir,'producao',w.runId);mkdirSync(folder,{recursive:true});renameSync(filename(dir),join(folder,'producao-workflow.json'));return w.runId;
}
// Modelo de prompt corrigido: troca só imagens ainda não geradas; a tentativa anterior fica no histórico.
export function updateImagePrompt(dir:string,id:string,prompt:string){
 const w=requireWorkflow(dir),j=job(w,id,'image');if(!['queued','error','pending_review'].includes(j.status))throw Error('Só imagem ainda não aprovada recebe prompt novo: '+id);if(!prompt.trim())throw Error('Prompt vazio');
 j.history.push({attempt:j.attempt,status:'prompt_replaced',prompt:j.prompt,error:j.error,output:j.output,sha256:j.sha256,executionPlan:j.executionPlan,at:now()});
 const attachments=j.inputs.map(a=>({file:a.path,role:(/contact|identidade/i.test(a.role)?'identity':'frame') as 'frame'|'identity'}));j.toolPrompts={chatgpt:adaptImagePrompt(prompt,attachments,'chatgpt'),nanobanana:adaptImagePrompt(prompt,attachments,'nanobanana')};
 j.attempt++;j.prompt=j.basePrompt=w.provider==='chatgpt'?j.toolPrompts.chatgpt:prompt;j.status='queued';delete j.output;delete j.sha256;delete j.error;delete j.token;delete j.executionPlan;delete j.recoveryStartedAt;
 const row=w.plan.stills.find((s:any)=>s.id===id);if(row)row.prompt=prompt;return save(dir,w,'prompt_replaced',id);
}
// Sem intenção de envio no flow-run do plano nada foi gerado nem cobrado: nova tentativa não conta no teto de recuperação.
export function requeueNeverSubmitted(dir:string,id:string,evidence:string){
 const w=requireWorkflow(dir),j=job(w,id);if(!['submitted','uncertain','error'].includes(j.status))return false;
 // Só a tentativa atual conta: sem plano fixado o controlador nem foi chamado. ChatGPT não usa plano e pode ter recibo pendente.
 const plan=j.executionPlan;if(!plan&&j.provider==='chatgpt')return false;
 if(plan){const state=join(plan,'..','flow-run.json');const proof=existsSync(state)?JSON.parse(readFileSync(state,'utf8')):null,item=proof?.items?.[id];
  if(proof?.events?.some((e:any)=>e.item===id&&['submission_intent','submission_uncertain','submission_not_acknowledged'].includes(e.phase)))return false;
  if(['submission_intent','submitted','available'].includes(item?.status))return false;if(item?.status==='uncertain'&&item?.submissionEvidence)return false;}
 j.history.push({attempt:j.attempt,status:'not_submitted',evidence,error:j.error,executionPlan:plan,at:now()});j.attempt++;delete j.error;delete j.token;delete j.executionPlan;delete j.receipt;delete j.recoveryStartedAt;
 const image=j.dependency?w.jobs.find(x=>x.id===j.dependency):null;j.status=j.kind==='image'||image?.status==='accepted'?'queued':'waiting_image';save(dir,w,'requeued_not_submitted',id);return true;
}
export function imageExtension(bytes:Buffer){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return '.jpg';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return '.webp';throw Error('Arquivo recebido não é PNG, JPEG ou WebP');}
export function recordImage(dir:string,id:string,source:string,token?:string){
 const w=requireWorkflow(dir),j=job(w,id,'image');if(j.token&&j.token!==token)throw Error('Token de posse do item não corresponde');
 const hash=fileHash(source);if(j.sha256===hash&&j.status==='accepted')return w;
 if(w.jobs.some(v=>v.dependency===id&&['running','submitted','available','uncertain'].includes(v.status)))throw Error('Vídeo já despachado; preserve a imagem desta tentativa');
 if(j.sha256&&j.sha256!==hash)throw Error('Imagem diferente já registrada; rejeite com motivo para criar outra tentativa');
 const bytes=readFileSync(source),ext=imageExtension(bytes),folder=join(dir,'producao',w.runId,'imagens',id,'tentativa-'+String(j.attempt).padStart(2,'0'));
 const output=join(folder,`${id}_${w.ref}_${w.slug}_A${String(j.attempt).padStart(2,'0')}${ext}`);
 mkdirSync(folder,{recursive:true});if(existsSync(output)&&fileHash(output)!==hash)throw Error('Imagem diferente já registrada; rejeite com motivo para criar outra tentativa');
 if(!existsSync(output))copyFileSync(source,output);
 // A aprovação humana pertence ao hash: os mesmos bytes não pedem outra decisão nesta produção.
 const approved=j.provider==='flow'?w.jobs.find(x=>x.kind==='image'&&x.sha256===hash&&x.decision?.approved&&!j.history.some(h=>h.status==='rejected'&&h.sha256===hash)):undefined;if(approved)j.decision={...approved.decision!,reusedFrom:approved.id};
 j.output=output;j.sha256=hash;j.status=j.provider==='flow'&&!approved?'pending_review':'accepted';delete j.token;delete j.error;
 if(j.status==='accepted')unlock(w,j);return save(dir,w,'image_received',id);
}
function unlock(w:Workflow,image:Job){for(const v of w.jobs.filter(v=>v.dependency===image.id&&v.status==='waiting_image')){v.inputs=[{path:image.output!,sha256:image.sha256!,role:'imagem inicial selecionada'}];v.status='queued';}}
export function decideImage(dir:string,id:string,approved:boolean,reason=''){
 const w=requireWorkflow(dir),j=job(w,id,'image');if(!['accepted','pending_review'].includes(j.status))throw Error('Imagem ainda não disponível para decisão');
 if(!approved&&!reason.trim())throw Error('Informe o motivo da reprovação');
 if(!j.output||fileHash(j.output)!==j.sha256)throw Error('Imagem selecionada foi alterada');
 const dependents=w.jobs.filter(v=>v.dependency===id);if(!approved&&dependents.some(v=>!['queued','waiting_image','waiting_shared'].includes(v.status)))throw Error('Vídeo já despachado; a correção precisa de nova versão');
 j.decision={approved,reason:reason.trim(),at:now()};
 if(approved){j.status='accepted';unlock(w,j);for(const same of w.jobs.filter(x=>x.kind==='image'&&x.id!==id&&x.status==='pending_review'&&x.sha256===j.sha256)){same.decision={...j.decision,reusedFrom:id};same.status='accepted';unlock(w,same);}}else{
  j.history.push({attempt:j.attempt,status:'rejected',output:j.output,sha256:j.sha256,decision:j.decision,prompt:j.prompt,executionPlan:j.executionPlan});
  j.attempt++;j.prompt=j.basePrompt+'\nCorreção solicitada pelo usuário: '+reason.trim();j.status='queued';delete j.output;delete j.sha256;delete j.token;delete j.executionPlan;
  for(const v of dependents){v.status='waiting_image';v.inputs=[];delete v.sharedWait;delete v.error;}
 }
 return save(dir,w,approved?'image_approved':'image_rejected',id);
}
export function claimJob(dir:string,kind:Job['kind']): (Job&{token:string})|null{
 if(kind==='image')resolveSharedImages(dir);else resolveSharedVideos(dir);
 const w=requireWorkflow(dir);if(!w.authorized)return null;
 const j=w.jobs.find(j=>j.kind===kind&&j.status==='queued'&&j.provider!=='manual');if(!j)return null;
 try{for(const i of j.inputs)if(fileHash(i.path)!==i.sha256)throw Error('hash divergente');}catch{j.status='error';j.error='Imagem ou anexo alterada após seleção: '+j.id;save(dir,w,'input_changed',j.id);throw Error(j.error);}
 j.status='running';j.token=randomUUID();save(dir,w,'claimed',j.id);return structuredClone(j) as Job&{token:string};
}
export function finishJob(dir:string,id:string,token:string,result:{status:JobStatus;error?:string;receipt?:any;executionPlan?:string;output?:string;sha256?:string}){
 const w=requireWorkflow(dir),j=job(w,id);if(j.token!==token)throw Error('Token de posse do item não corresponde');Object.assign(j,result);if(['submitted','uncertain'].includes(result.status))j.recoveryStartedAt=now();delete j.token;return save(dir,w,'job_'+result.status,id);
}
export function recoverInterrupted(dir:string){const w=readWorkflow(dir);if(!w)return;for(const j of w.jobs)if(j.status==='running'&&j.provider!=='chatgpt'&&!j.executionPlan){j.status='queued';delete j.token;}else if(j.status==='running'){j.status='uncertain';j.recoveryStartedAt=now();j.error='Executor interrompido. Recuperar saída existente antes de repetir.';delete j.token;}save(dir,w,'resumed');}
export function updateJobPlan(dir:string,id:string,token:string,plan:string){const w=requireWorkflow(dir),j=job(w,id);if(j.token!==token)throw Error('Token de posse do item não corresponde');j.executionPlan=plan;save(dir,w,'plan_pinned',id);}
export function authorizeWorkflow(dir:string,maxCredits:number){const w=requireWorkflow(dir);if(!Number.isFinite(maxCredits)||maxCredits<0)throw Error('Teto de créditos inválido');w.authorized=true;w.plan.settings.maxCredits=maxCredits;for(const j of w.jobs)if(['submitted','uncertain'].includes(j.status))j.recoveryStartedAt=now();return save(dir,w,'production_authorized');}
export function needsCollection(j:Job,clock=Date.now()){return ['submitted','uncertain'].includes(j.status)&&!!j.executionPlan&&clock-Date.parse(j.recoveryStartedAt??'')<15*60*1000;}
// Coleta nova sem tocar autorização, teto ou tentativa: nenhum envio sai por causa dela.
export function beginCollectionProbe(dir:string,ids:string[]){const w=requireWorkflow(dir);for(const j of w.jobs)if(ids.includes(j.id))delete j.retryCollection;return save(dir,w,'collection_probe');}
export function recordCollectionError(dir:string,id:string,message:string,terminal=false){
 const w=requireWorkflow(dir),j=job(w,id);j.error=message;j.collectionError={message,at:now(),terminal};if(terminal)j.status='error';return save(dir,w,'collection_error',id);
}
export function reopenCollection(dir:string){const w=requireWorkflow(dir),jobs=w.jobs.filter(j=>(['submitted','uncertain'].includes(j.status)||j.collectionError)&&j.executionPlan);for(const j of jobs){j.recoveryStartedAt=now();j.retryCollection=true;if(j.collectionError){j.status='uncertain';j.retryCollection=true;delete j.error;delete j.collectionError;}}if(jobs.length)save(dir,w,'collection_reopened');return jobs.length;}

// Uma resposta só, calculada do estado persistido, para qualquer agente saber o próximo passo sem interpretar a fila.
export function productionNextAction(w:Workflow,clock=Date.now()){
 const has=(...statuses:JobStatus[])=>w.jobs.some(j=>statuses.includes(j.status));
 if(w.jobs.every(j=>j.kind==='image'||j.status==='available'))return 'editar';
 if(has('pending_review'))return 'aprovar_imagens';
 if(w.provider==='manual'&&w.jobs.some(j=>j.kind==='image'&&j.status==='queued'))return 'receber_imagens';
 if(!w.authorized&&has('queued'))return 'autorizar';
 if(has('queued','running'))return 'executar_fila';
 if(w.jobs.some(j=>needsCollection(j,clock)))return 'aguardar_coleta';
 if(w.jobs.some(j=>['submitted','uncertain'].includes(j.status)&&j.executionPlan))return 'coletar';
 if(w.jobs.some(j=>j.status==='waiting_shared'&&!j.error))return 'aguardar_coleta';
 return 'resolver_erro';
}
// Item que o controlador nunca registrou como enviado volta à fila numa tentativa nova; o plano anterior fica no histórico.
export function requeueUnsubmitted(dir:string){
 const w=readWorkflow(dir);if(!w)return 0;let n=0;
 for(const j of w.jobs){
  if(j.status!=='error'||!j.error?.includes('não registrou intenção de envio'))continue;
  j.history.push({attempt:j.attempt,status:'not_submitted',error:j.error,executionPlan:j.executionPlan,at:now()});
  j.attempt++;delete j.error;delete j.token;delete j.executionPlan;delete j.recoveryStartedAt;
  const image=j.dependency?w.jobs.find(x=>x.id===j.dependency):null;
  j.status=j.kind==='video'&&image?.status!=='accepted'?'waiting_image':'queued';n++;
 }
 if(n)save(dir,w,'requeued_unsubmitted');return n;
}
export function markUnsubmitted(dir:string,id:string){const w=requireWorkflow(dir),j=job(w,id);j.status='error';j.error=(j.error?j.error+'\n':'')+'O controlador não registrou intenção de envio. Preparo incompleto; nenhuma geração foi repetida.';return save(dir,w,'not_submitted',id);}
export function completeCollectedVideo(dir:string,id:string,result:{file:string;sha256:string}){const w=requireWorkflow(dir),j=job(w,id,'video');if((!['submitted','uncertain'].includes(j.status)&&!j.collectionError)||fileHash(result.file)!==result.sha256)throw Error('Clipe coletado não corresponde ao envio');j.output=result.file;j.sha256=result.sha256;j.status='available';delete j.error;delete j.collectionError;writeEditingHandoff(dir,w);return save(dir,w,'video_collected',id);}
function writeEditingHandoff(dir:string,w:Workflow){if(!w.jobs.filter(j=>j.kind==='video').every(j=>j.status==='available'))return;const folder=join(dir,'producao',w.runId,'edicao');mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'manifesto.json'),JSON.stringify({schema:'irh-editing-handoff/v1',ref:w.ref,expert:w.slug,editor:w.editing,status:'aguardando_edicao',clips:w.jobs.filter(j=>j.kind==='video').map(j=>({id:j.id,path:j.output,sha256:j.sha256,source:w.plan.shots.find((s:any)=>s.id===j.id),...(j.sharedFrom?{sharedFrom:j.sharedFrom}:{})})),composition:w.plan.editing,note:'Ajustar pequenas sobras nas bordas durante a montagem; não aplicar trim universal ou retake automático.'},null,2));}
// A base do fundo também é compartilhada: gerar outra imagem mudaria o hash e impediria reutilizar o vídeo.
function fundoImageKey(w:Workflow,j:Job){
 if(j.kind!=='image'||j.inputs.some(i=>/identidade|contact sheet/i.test(i.role)))return null;
 const uses=w.plan.shots?.filter((s:any)=>s.still===j.id)??[];
 if(!uses.length||uses.some((s:any)=>s.layer!=='fundo'||s.speechMode!=='none'||s.speech?.trim()))return null;
 if(j.inputs.some(i=>!existsSync(i.path)||fileHash(i.path)!==i.sha256))return null;
 return JSON.stringify([w.ref,w.plan.version,j.provider,j.basePrompt,j.inputs.map(i=>[i.sha256,i.role])]);
}
export function resolveSharedImages(dir:string){
 let w=readWorkflow(dir);if(!w?.authorized)return;
 const others=readdirSync(dirname(dir),{withFileTypes:true}).filter(e=>e.isDirectory()&&join(dirname(dir),e.name)!==dir).map(e=>readWorkflow(join(dirname(dir),e.name))).filter((x):x is Workflow=>x?.ref===w!.ref&&x.runId!==w!.runId);
 const label=(x:Workflow,j:Job)=>x.slug+'/'+j.id;
 for(const id of w.jobs.filter(j=>['queued','waiting_shared'].includes(j.status)&&fundoImageKey(w!,j)).map(j=>j.id)){
  const j=w.jobs.find(x=>x.id===id)!,key=fundoImageKey(w,j);
  const peers=[w,...others].flatMap(x=>x.jobs.filter(o=>o!==j&&fundoImageKey(x,o)===key).map(o=>({w:x,j:o}))).sort((a,b)=>label(a.w,a.j).localeCompare(label(b.w,b.j)));
  const source=peers.find(p=>p.j.status==='accepted'&&p.j.output&&existsSync(p.j.output)&&fileHash(p.j.output)===p.j.sha256);
  if(source){
   w=recordImage(dir,id,source.j.output!);const received=w.jobs.find(x=>x.id===id)!;
   received.sharedFrom={runId:source.w.runId,slug:source.w.slug,job:source.j.id,file:source.j.output!,sha256:source.j.sha256!,at:now()};delete received.sharedWait;delete received.error;
   save(dir,w,'image_reused',id);continue;
  }
  const failed=peers.find(p=>['error','accepted'].includes(p.j.status));
  const wait=peers.find(p=>['running','submitted','uncertain','pending_review'].includes(p.j.status))??failed??peers.find(p=>p.w.authorized&&['queued','waiting_shared'].includes(p.j.status)&&label(p.w,p.j).localeCompare(label(w!,j))<0);
  const before=JSON.stringify([j.status,j.error,j.sharedWait]);delete j.error;delete j.sharedWait;j.status=wait?'waiting_shared':'queued';
  if(wait)j.sharedWait={runId:wait.w.runId,slug:wait.w.slug,job:wait.j.id};
  if(wait&&wait===failed)j.error='Imagem-fonte compartilhada precisa de recuperação na origem; não gerar outra base.';
  if(before!==JSON.stringify([j.status,j.error,j.sharedWait]))save(dir,w,wait?'shared_image_wait':'shared_image_released',id);
 }
}
// Fundo sem avatar com o mesmo pedido e a mesma imagem aceita é o mesmo vídeo em qualquer personagem da REF: uma geração só.
// shortcut: REF0016/0017 têm planos de antes e depois do ajuste de template; só essas duas frases são ignoradas. Quando não houver plano antigo em aberto, remover para ficar literal.
const TEMPLATE_FUNDO=[/^Plano contínuo\. /,/ Mudanças de etapa ou recipiente seguem os cortes observados na referência, sem transformar um objeto em outro\./];
function fundoKey(w:Workflow,j:Job){
 const shot=j.kind==='video'?w.plan.shots?.find((s:any)=>s.id===j.id):null,image=w.jobs.find(x=>x.id===j.dependency);
 if(shot?.layer!=='fundo'||shot.speechMode!=='none'||shot.speech?.trim()||image?.status!=='accepted'||!image.sha256)return null;
 const {videoModel,videoMode,resolution,aspectRatio,count}=w.plan.settings;
 return JSON.stringify([w.ref,w.plan.version,TEMPLATE_FUNDO.reduce((p,t)=>p.replace(t,''),j.basePrompt),shot.sourceWindow,shot.duration,videoModel,videoMode,resolution,aspectRatio,count,image.sha256]);
}
const PEDIDO_EXPLICITO=['user_retake','model_retry','explicit_attempt'];
// Roda antes do claim, tudo síncrono: o servidor é um processo só, então dois workflows nunca pegam o mesmo fundo.
function normalizeUnsubmittedBackgroundTiming(dir:string){
 const w=readWorkflow(dir);if(!w)return;let changed=false;
 for(const j of w.jobs){
  if(j.kind!=='video'||!['queued','waiting_shared','waiting_image'].includes(j.status)||j.executionPlan||j.history.some(h=>PEDIDO_EXPLICITO.includes(h.status)))continue;
  const shot=w.plan.shots?.find((s:any)=>s.id===j.id);
  if(shot?.layer!=='fundo'||shot.speechMode!=='none'||!Array.isArray(shot.sourceWindow))continue;
  const seconds=shot.sourceWindow[1]-shot.sourceWindow[0],presets=/^Veo/.test(w.plan.settings.videoModel??'')?[4,6,8]:[4,6,8,10];
  const duration=presets.find(n=>n>=Math.max(seconds,shot.requestedDuration??shot.duration));
  if(duration&&shot.duration!==duration){shot.duration=shot.requestedDuration=duration;shot.speechEstimate=0;shot.durationReason=`Ação sem fala: janela ${seconds}s, preset ${duration}s. Retomada antes de qualquer envio desta tentativa.`;changed=true;}
 }
 if(changed)save(dir,w,'background_timing_reconciled');
}
export function resolveSharedVideos(dir:string){
 normalizeUnsubmittedBackgroundTiming(dir);
 const w=readWorkflow(dir);if(!w?.authorized)return;
 const mine=w.jobs.filter(j=>['queued','waiting_shared'].includes(j.status)&&!j.history.some(h=>PEDIDO_EXPLICITO.includes(h.status))&&fundoKey(w,j));if(!mine.length)return;
 const root=dirname(dir),others=readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&join(root,e.name)!==dir).map(e=>readWorkflow(join(root,e.name))).filter((x):x is Workflow=>x?.ref===w.ref&&x.runId!==w.runId);
 const label=(x:Workflow,o:Job)=>x.slug+'/'+o.id;
 for(const j of mine){
  const key=fundoKey(w,j),peers=[w,...others].flatMap(x=>x.jobs.filter(o=>o!==j&&fundoKey(x,o)===key).map(o=>({w:x,j:o}))).sort((a,b)=>label(a.w,a.j).localeCompare(label(b.w,b.j)));
  const source=peers.find(p=>p.j.status==='available'&&p.j.output&&existsSync(p.j.output)&&fileHash(p.j.output)===p.j.sha256);
  if(source){
   j.output=source.j.output;j.sha256=source.j.sha256;j.status='available';j.sharedFrom={runId:source.w.runId,slug:source.w.slug,job:source.j.id,file:source.j.output!,sha256:source.j.sha256!,at:now()};delete j.error;delete j.sharedWait;
   writeEditingHandoff(dir,w);save(dir,w,'video_reused',j.id);continue;
  }
  const failed=peers.find(p=>['error','available'].includes(p.j.status));
  // Dono determinístico: entre os ainda não enviados, gera o primeiro em ordem; produção sem autorização não é dona.
  const wait=peers.find(p=>['running','submitted','uncertain'].includes(p.j.status))??failed??peers.find(p=>p.w.authorized&&['queued','waiting_shared'].includes(p.j.status)&&label(p.w,p.j).localeCompare(label(w,j))<0);
  const before=JSON.stringify([j.status,j.error,j.sharedWait]);
  delete j.error;delete j.sharedWait;j.status=wait?'waiting_shared':'queued';
  if(wait)j.sharedWait={runId:wait.w.runId,slug:wait.w.slug,job:wait.j.id};
  if(wait&&wait===failed)j.error=`Fonte compartilhada ${label(wait.w,wait.j)} ${wait.j.status==='error'?'falhou':'com arquivo ausente ou alterado'}; recuperar na origem, sem nova geração aqui.`;
  if(before!==JSON.stringify([j.status,j.error,j.sharedWait]))save(dir,w,wait?'shared_wait':'shared_released',j.id);
 }
}
// Renomes cadastrais conhecidos (01/11/2026). O plano só é religado se a fonte atual, com o nome antigo de volta, reproduzir exatamente o hash gravado.
const RENAMED_SLUGS:Record<string,string>={'cozinheiras-da-vovo-loira':'mini-chefs-da-vovo-loira','cozinheiras-da-vovo-morena':'mini-chefs-da-vovo-morena'};
export function rebindRenamedSources(dir:string){
 const w=requireWorkflow(dir),plan=w.plan,old=plan.identity?.expertSlug,neu=RENAMED_SLUGS[old];if(!neu||w.slug!==old||basename(realpathSync(dir))!==neu)return false;
 const swap=(p:string)=>p.split('/'+old+'/').join('/'+neu+'/'),sha=(t:string)=>createHash('sha256').update(t).digest('hex'),next=structuredClone(plan);
 for(const [path,hash] of [['replicationPath','replicationSha256'],['expertProfilePath','expertProfileSha256']]){
  if(!plan.source?.[path])continue;const file=swap(plan.source[path]),text=readFileSync(file,'utf8');
  if(sha(text.split(neu).join(old))!==plan.source[hash])throw Error('Fonte mudou além do rename '+old+' → '+neu+': '+path);
  next.source[path]=file;next.source[hash]=sha(text);
 }
 const sheet=swap(plan.identity.contactSheet.path);if(fileHash(sheet)!==plan.identity.contactSheet.sha256)throw Error('contact sheet diferente após rename: '+sheet);
 next.identity.expertSlug=neu;next.identity.contactSheet.path=sheet;
 for(const a of next.assets??[])if(a.path?.includes('/'+old+'/')){a.path=swap(a.path);if(a.sha256&&fileHash(a.path)!==a.sha256)throw Error('Anexo diferente após rename: '+a.id);}
 (w as any).renamedFrom={slug:old,at:now(),replicationSha256:plan.source?.replicationSha256,expertProfileSha256:plan.source?.expertProfileSha256};w.plan=next;w.slug=neu;save(dir,w,'sources_renamed');return true;
}
// Imagens aceitas com o mesmo conteúdo são uma base só (react invariável): o primeiro job é o canônico e os demais são aliases.
// Jobs, takes e slots de shot ficam intactos; conteúdo diferente continua sendo outra base.
export function imageBases(w:Workflow){
 const bases=new Map<string,{sha256:string;canonical:string;output:string;aliases:string[];shots:string[]}>();
 for(const j of w.jobs){
  if(j.kind!=='image'||j.status!=='accepted'||!j.sha256)continue;
  const b=bases.get(j.sha256);if(b)b.aliases.push(j.id);else bases.set(j.sha256,{sha256:j.sha256,canonical:j.id,output:j.output!,aliases:[],shots:[]});
 }
 for(const j of w.jobs){if(j.kind!=='video')continue;const image=w.jobs.find(x=>x.id===j.dependency);const b=image?.sha256&&bases.get(image.sha256);if(b)b.shots.push(j.id);}
 return [...bases.values()];
}
// Recusa explícita de conteúdo/licenciamento não é falha de download ou timeout. Não gera outra vez automaticamente.
export function recordProviderRefusal(dir:string,id:string,evidence:string,submissionTag:string){
 if(!evidence.trim()||!submissionTag.trim())throw Error('Recusa exige motivo e identificador da tentativa');
 const w=requireWorkflow(dir),j=job(w,id);if(!['submitted','uncertain'].includes(j.status))return w;
 if(!j.executionPlan||!existsSync(j.executionPlan))throw Error('Recusa sem plano fixado');
 const plan=JSON.parse(readFileSync(j.executionPlan,'utf8')),row=[...(plan.shots??[]),...(plan.stills??[])].find((x:any)=>x.id===id);
 if(row?.submissionTag!==submissionTag)throw Error('Recusa pertence a outra tentativa');
 j.history.push({attempt:j.attempt,status:'provider_refused',evidence,submissionTag,executionPlan:j.executionPlan,receipt:j.receipt,at:now()});
 j.status='error';j.error='Recusa explícita do provedor; sem nova geração automática. '+evidence;delete j.collectionError;delete j.recoveryStartedAt;
 return save(dir,w,'provider_refused',id);
}
// Recusa do provedor observada (ex.: Flow "Failed"): preserva a tentativa no histórico e libera uma nova, sem nova imagem.
// Uma segunda recusa do mesmo item vira bloqueio registrado: não repete gerações indefinidamente.
export function markProviderFailed(dir:string,id:string,evidence:string){return retryOnce(dir,id,evidence,'provider_failed','Provedor recusou de novo');}
// Envio aceito cujo resultado não foi achado após coleta esgotada (coleção e projeto). Não é recusa: só ausência comprovada pela coleta.
export function markMissingResult(dir:string,id:string,evidence:string){return retryOnce(dir,id,evidence,'missing_result','Resultado ausente de novo após coleta');}
function retryOnce(dir:string,id:string,evidence:string,kind:'provider_failed'|'missing_result',again:string){
 if(!evidence.trim())throw Error('Informe a evidência observada');
 const w=requireWorkflow(dir),j=job(w,id);if(!['submitted','uncertain'].includes(j.status))throw Error('Só um envio registrado pode receber nova tentativa');
 j.history.push({attempt:j.attempt,status:kind,evidence,executionPlan:j.executionPlan,receipt:j.receipt,at:now()});
 // Teto de recuperação por item, somando ausência e recusa: uma nova tentativa no total, depois bloqueio registrado.
 if(j.history.filter(h=>h.status==='missing_result'||h.status==='provider_failed').length>=2){j.status='error';j.error=again+'; bloqueio registrado, sem nova geração automática. '+evidence;delete j.recoveryStartedAt;return save(dir,w,kind+'_blocked',id);}
 j.attempt++;delete j.executionPlan;delete j.receipt;delete j.recoveryStartedAt;delete j.error;
 const image=j.dependency?w.jobs.find(x=>x.id===j.dependency):null;j.status=j.kind==='image'||image?.status==='accepted'?'queued':'waiting_image';
 return save(dir,w,kind,id);
}
// Nova tentativa pedida explicitamente pelo usuário (falha anterior ou clipe disponível com defeito comprovado).
// Uma por item; histórico guarda status, plano, recibo, arquivo e hash anteriores. Fala/prompt não mudam; duração só sobe a preset válido.
export function authorizeRetake(dir:string,id:string,input:{reason:string;authorization:string;duration?:number}){
 if(!input.authorization?.trim())throw Error('Informe a autorização explícita do usuário');
 if(!input.reason?.trim())throw Error('Informe o motivo da nova tentativa');
 const w=requireWorkflow(dir),j=job(w,id,'video'),shot=w.plan.shots.find((s:any)=>s.id===id);
 if(j.history.some(h=>h.status==='user_retake'))throw Error('Este item já usou a nova tentativa autorizada');
 if(!['error','available'].includes(j.status))throw Error('Só item em erro ou disponível recebe nova tentativa autorizada');
 const from=shot?.duration;
 if(input.duration!==undefined&&(![4,6,8].includes(input.duration)||input.duration<from))throw Error('A duração só pode subir para um preset válido (4/6/8 s)');
 j.history.push({attempt:j.attempt,status:'user_retake',previousStatus:j.status,error:j.error,executionPlan:j.executionPlan,receipt:j.receipt,output:j.output,sha256:j.sha256,sharedFrom:j.sharedFrom,reason:input.reason,authorization:input.authorization,durationFrom:from,durationTo:input.duration??from,at:now()});
 if(input.duration!==undefined&&shot){shot.duration=input.duration;shot.requestedDuration=input.duration;}
 j.attempt++;for(const k of ['error','executionPlan','receipt','output','sha256','recoveryStartedAt','token','sharedFrom'] as const)delete (j as any)[k];
 const image=j.dependency?w.jobs.find(x=>x.id===j.dependency):null;j.status=image?.status==='accepted'?'queued':'waiting_image';
 return save(dir,w,'user_retake',id);
}
// Variante de modelo da MESMA família/provedor, uma vez por item, depois da tentativa autorizada sem resultado (ou recusada).
// O perfil global do expert não muda: cria-se um snapshot imutável igual a ele, só com flow.videoModel trocado, e o plano base
// desta produção passa a apontar para ele. Fala, prompt, duração e imagem não mudam. O histórico guarda o plano base inteiro.
const VARIANTES_PERMITIDAS=['Veo 3.1 - Fast','Veo 3.1 - Lite'];
// Troca de modelo pedida pelo usuário para os itens ainda não gerados desta versão (ex.: créditos acabando).
// Clipes já disponíveis ficam como estão; o plano anterior inteiro vai para w.modelSwitches. Mesmo snapshot de authorizeModelRetry.
export function switchVideoModel(dir:string,input:{model:string;authorization:string;reason:string}){
 if(!VARIANTES_PERMITIDAS.includes(input.model))throw Error('Variante de modelo fora da lista permitida: '+input.model);
 if(!input.authorization?.trim())throw Error('Informe a autorização explícita do usuário');
 if(!input.reason?.trim())throw Error('Informe o motivo');
 const w=requireWorkflow(dir);if(w.plan.settings.videoModel===input.model)throw Error('A versão já usa '+input.model);
 const from=w.plan.source?.expertProfilePath,profile=JSON.parse(readFileSync(from,'utf8'));
 const snapshot={...profile,flow:{...profile.flow,videoModel:input.model}};
 const file=join(dir,'producao-perfil-'+input.model.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.json'),text=JSON.stringify(snapshot,null,2)+'\n';
 if(existsSync(file)&&readFileSync(file,'utf8')!==text)throw Error('Snapshot de perfil já existe com outro conteúdo; preservar');
 if(!existsSync(file))writeFileSync(file,text);
 (w as any).modelSwitches=[...((w as any).modelSwitches??[]),{modelFrom:w.plan.settings.videoModel,modelTo:input.model,reason:input.reason,authorization:input.authorization,planBefore:structuredClone(w.plan),at:now()}];
 w.plan.source.expertProfilePath=file;w.plan.source.expertProfileSha256=fileHash(file);w.plan.settings.videoModel=input.model;
 return save(dir,w,'video_model_switch');
}
export function authorizeModelRetry(dir:string,id:string,input:{reason:string;authorization:string;model:string}){
 if(!VARIANTES_PERMITIDAS.includes(input.model))throw Error('Variante de modelo fora da lista permitida: '+input.model);
 if(!input.authorization?.trim())throw Error('Informe a autorização explícita do usuário');
 if(!input.reason?.trim())throw Error('Informe o motivo');
 const w=requireWorkflow(dir),j=job(w,id,'video');
 if(j.history.some(h=>h.status==='model_retry'))throw Error('Este item já usou a variante de modelo');
 if(!j.history.some(h=>h.status==='user_retake'))throw Error('A variante só vale depois da tentativa autorizada pelo usuário');
 if(j.status!=='error')throw Error('Registre antes o resultado da tentativa anterior (ausência/recusa); item precisa estar em erro');
 const from=w.plan.source?.expertProfilePath,profile=JSON.parse(readFileSync(from,'utf8'));
 const snapshot={...profile,flow:{...profile.flow,videoModel:input.model}};
 const file=join(dir,'producao-perfil-'+input.model.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.json'),text=JSON.stringify(snapshot,null,2)+'\n';
 if(existsSync(file)&&readFileSync(file,'utf8')!==text)throw Error('Snapshot de perfil já existe com outro conteúdo; preservar');
 if(!existsSync(file))writeFileSync(file,text);
 j.history.push({attempt:j.attempt,status:'model_retry',previousStatus:j.status,error:j.error,executionPlan:j.executionPlan,receipt:j.receipt,output:j.output,sha256:j.sha256,
  reason:input.reason,authorization:input.authorization,modelFrom:w.plan.settings.videoModel,modelTo:input.model,profileFrom:from,profileFromSha256:w.plan.source.expertProfileSha256,profileTo:file,planBefore:structuredClone(w.plan),at:now()});
 w.plan.source.expertProfilePath=file;w.plan.source.expertProfileSha256=fileHash(file);w.plan.settings.videoModel=input.model;
 j.attempt++;for(const k of ['error','executionPlan','receipt','output','sha256','recoveryStartedAt','token'] as const)delete (j as any)[k];
 const image=j.dependency?w.jobs.find(x=>x.id===j.dependency):null;j.status=image?.status==='accepted'?'queued':'waiting_image';
 return save(dir,w,'model_retry',id);
}

export {save as saveWorkflow};
