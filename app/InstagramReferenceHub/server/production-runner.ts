import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {generateChatGPT} from '../scripts/chatgpt-image';
import {claimJob,fileHash,recordCollectionError,recordProviderRefusal,beginCollectionProbe,finishJob,readWorkflow,recordImage,updateJobPlan,needsCollection,markUnsubmitted,resolveSharedVideos,type Job,type Workflow} from './production-workflow';

export async function dispatchReady<T>({next,execute,concurrency}:{next:()=>T|null;execute:(job:T,worker:number)=>Promise<void>;concurrency:number}){
 await Promise.all(Array.from({length:concurrency},async(_,worker)=>{for(;;){const job=next();if(!job)return;await execute(job,worker);}}));
}
const FLOW=resolve(import.meta.dir,'../../GoogleFlowMCP');
const WIN=process.platform==='win32';
const PYTHON=process.env.IRH_HARNESS_PYTHON||(WIN?join(process.env.APPDATA||'','uv/tools/browser-harness/Scripts/python.exe'):((process.env.HOME||'')+'/.local/share/uv/tools/browser-harness/bin/python'));
// Uma fila por aba do Flow: a mesma aba é serial; abas diferentes (FLOW_TARGET_ID) trabalham ao mesmo tempo.
const flowLanes=new Map<string,Promise<unknown>>();
export const inCollectionLane=<T>(run:()=>Promise<T>)=>inFlowLane('__flow_collection__',run);
export function inFlowLane<T>(key:string,run:()=>Promise<T>):Promise<T>{const next=(flowLanes.get(key)??Promise.resolve()).then(run,run);flowLanes.set(key,next.catch(()=>{}));return next;}
// Vínculo REF--slug → aba criada por flow-control prepare-batch-tabs; sem arquivo, tudo usa a aba configurada.
export function flowTargets(file=process.env.IRH_FLOW_TARGETS):Record<string,string>{
 if(!file)return {};const data=JSON.parse(readFileSync(file,'utf8'));
 if(data.schema!=='irh-flow-targets/v1'||typeof data.targets!=='object')throw Error('Vínculo de abas inválido');
 const values=Object.values(data.targets);if(values.some(v=>typeof v!=='string'||!v)||new Set(values).size!==values.length)throw Error('Cada REF+personagem precisa de uma aba distinta');
 return data.targets;
}
async function command(args:string[],target?:string){const p=Bun.spawn(args,{stdout:'pipe',stderr:'pipe',env:{...process.env,...(target?{FLOW_TARGET_ID:target}:{})}});const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code!==0)throw Error((out||err).slice(-1200));const lines=out.trim().split('\n').filter(Boolean);return JSON.parse(lines.at(-1)||'{}');}
const controlOn=(target:string|undefined,...args:string[])=>command([...(WIN?[PYTHON]:[]),join(FLOW,'scripts/flow-control'),...args],target);
// Vídeos independentes da mesma REF saem por uma janela própria (IRH_FLOW_TABS para mais; janelas sobrepostas perderam a grade em 03/11), abertas e reabertas sem intervenção.
export const FLOW_TABS=Math.max(1,Math.min(9,Number(process.env.IRH_FLOW_TABS)||1));
export async function tabFor(w:Pick<Workflow,'ref'|'slug'|'plan'>,lane=0,run:(...args:string[])=>Promise<any>=(...args)=>controlOn(undefined,...args)){
 const key=w.ref+'--'+w.slug,explicit=flowTargets()[key];if(explicit)return explicit;
 return (await run('ensure-tab','--key',key+'#'+lane,'--project',w.plan.organization.projectUrl)).targetId as string;
}
export function submissionTag(w:Pick<Workflow,'runId'|'ref'|'slug'>,j:Pick<Job,'id'|'attempt'>){return `IRH:${w.ref}:${w.slug}:${w.runId}:${j.id}:A${j.attempt}`;}
function reserved(w:Workflow){let amount=0;const seen=new Set<string>();for(const j of w.jobs)for(const p of [j.executionPlan,...j.history.map(h=>h.executionPlan)]){if(!p||seen.has(p))continue;seen.add(p);const state=join(dirname(p),'flow-run.json');if(existsSync(state)){const s=JSON.parse(readFileSync(state,'utf8'));amount+=Object.values(s.items??{}).reduce((n:number,i:any)=>n+(i.quotedCredits??0),0);}}return amount;}
// IDs de still do plano de produção não coincidem com os takes da análise; o vínculo é o hash do frame anexado.
export function originalStillFor(replication:any,plan:any){const hashes=new Set(plan.stills[0].inputs.map((id:string)=>plan.assets.find((a:any)=>a.id===id)?.sha256));return replication.stills?.find((s:any)=>hashes.has(s.frame_sha256));}
// O campo do Flow não preserva quebra de linha; correção de reprovação vem em linha nova e reprovaria a conferência literal.
export const singleLine=(prompt:string)=>prompt.replace(/\s*\n+\s*/g,' ').trim();
export function pinExecutionPlan(dir:string,w:Workflow,j:Job&{token:string}){
 const root=join(FLOW,'outputs',w.ref,w.slug,'workflow-'+w.runId,j.id,'tentativa-'+j.attempt);mkdirSync(root,{recursive:true});
 const file=join(root,'plano.json');if(existsSync(file))throw Error('Plano da tentativa já existe; recuperar, sem repetir envio');
 const plan=structuredClone(w.plan);plan.outputDir=root;plan.settings.maxCredits=Math.max(0,plan.settings.maxCredits-reserved(w));
 if(j.kind==='image'){
  const row=plan.stills.find((s:any)=>s.id===j.id);row.submissionTag=submissionTag(w,j);row.prompt=singleLine(j.prompt)+' ID técnico do pedido (metadado; não escrever na imagem): '+row.submissionTag;
 }else{
  plan.shots=plan.shots.filter((s:any)=>s.id===j.id);const shot=plan.shots[0],image=w.jobs.find(x=>x.id===j.dependency)!;
  shot.submissionTag=submissionTag(w,j);shot.prompt+=' ID técnico do pedido (metadado; não falar nem exibir): '+shot.submissionTag;
  if(!image.output||image.status!=='accepted'||fileHash(image.output)!==image.sha256)throw Error('Imagem inicial não está aceita com o hash atual');
  plan.stills=plan.stills.filter((s:any)=>s.id===shot.still);plan.stills[0].output=image.output;
  plan.assets.push({id:'imagem-selecionada',path:image.output,sha256:image.sha256,name:image.output.split(/[\\/]/).pop(),role:'imagem inicial selecionada'});
  plan.selection={videoRequiresSelectedCandidate:false,reason:'Imagem aceita no workflow '+w.runId+'; hash '+image.sha256};
  const replication=JSON.parse(readFileSync(plan.source.replicationPath,'utf8'));
  const original=originalStillFor(replication,plan);
  if(original){
   const selected=join(root,'selected-images.json');writeFileSync(selected,JSON.stringify({schema:'flow-selected-images/v1',ref:w.ref,expertSlug:w.slug,avatarName:plan.identity.avatarName,contactSheetSha256:plan.identity.contactSheet.sha256,images:[{still:shot.still,selected:true,path:image.output,sha256:image.sha256,referenceTake:original.take,referenceFrameSha256:original.frame_sha256}]}));
   plan.source.selectedImagesPath=selected;plan.source.selectedImagesSha256=fileHash(selected);
  }
 }
 writeFileSync(file,JSON.stringify(plan,null,2));updateJobPlan(dir,j.id,j.token,file);return file;
}
export class ProductionRunner{
 private active=new Set<string>();private rerun=new Set<string>();private timers=new Map<string,ReturnType<typeof setTimeout>>();private stopped=false;
 wake(dir:string){if(this.stopped)return;if(this.active.has(dir)){this.rerun.add(dir);void this.drainVideos(dir).catch(e=>console.error((e as Error).message));return;}const timer=this.timers.get(dir);if(timer){clearTimeout(timer);this.timers.delete(dir);}this.active.add(dir);void this.run(dir).catch(e=>{console.error('Production runner:',(e as Error).message);}).finally(()=>{this.active.delete(dir);if(this.stopped)return;if(this.rerun.delete(dir)){this.wake(dir);return;}if(readWorkflow(dir)?.jobs.some(j=>needsCollection(j)||j.status==='waiting_shared')){const t=setTimeout(()=>{this.timers.delete(dir);this.wake(dir);},20000);t.unref();this.timers.set(dir,t);}});}
 stop(){this.stopped=true;for(const t of this.timers.values())clearTimeout(t);}
 private uploads=new Map<string,Promise<void>>();private sent=new Map<string,Set<string>>();
 private async execute(dir:string,j:Job&{token:string},lane=0){
  try{
   const w=readWorkflow(dir)!;
   if(j.kind==='image'&&j.provider==='chatgpt'){
    const target=join(dir,'producao',w.runId,'requests',j.id,'tentativa-'+j.attempt);
    const receipt=await generateChatGPT(j,target);recordImage(dir,j.id,receipt.file,j.token);await this.drainVideos(dir);return;
   }
   const target=await tabFor(w,lane);await inFlowLane(target,async()=>{
    const file=pinExecutionPlan(dir,readWorkflow(dir)!,j),plan=JSON.parse(readFileSync(file,'utf8'));
    if(j.kind==='video'){
     const result=await controlOn(target,'execute-plan','--plan',file,'--shot-number','1','--submit');
     if(!['submitted','available'].includes(result.status))throw Error('Flow não confirmou submissão: '+JSON.stringify(result));
     finishJob(dir,j.id,j.token,{status:result.status,receipt:result,executionPlan:file});
    }else{
     await controlOn(target,'ensure-collection','--expert',plan.organization.expertProjectName,'--reference',w.ref,'--project',plan.organization.projectUrl);
     await controlOn(target,'run-plan','--plan',file,'--phase','prepare');await controlOn(target,'run-plan','--plan',file,'--phase','inputs');
     await controlOn(target,'run-plan','--plan',file,'--phase','image','--kind','still','--item',j.id);
     const state=await controlOn(target,'run-plan','--plan',file,'--phase','status'),quote=state.items?.[j.id]?.settingsSnapshot?.quote;
     if(!Number.isFinite(quote)||quote<0)throw Error('Cotação de imagem não observada');
     const result=await controlOn(target,'run-plan','--plan',file,'--phase','submit','--kind','still','--item',j.id,'--quote',String(quote),'--submit-name','Start generation','--acknowledge-spend');
     if(result.status!=='submitted')throw Error('Flow não confirmou submissão da imagem');finishJob(dir,j.id,j.token,{status:'submitted',receipt:result,executionPlan:file});
    }
   });
  }catch(e){const current=readWorkflow(dir)!.jobs.find(x=>x.id===j.id)!;if(current.token===j.token){finishJob(dir,j.id,j.token,{status:'uncertain',error:(e as Error).message});if(!current.executionPlan&&j.provider!=='chatgpt')markUnsubmitted(dir,j.id);}}
 }
 private async collect(dir:string){
  const w=readWorkflow(dir);if(!w)return;
  const pending=w.jobs.filter(j=>needsCollection(j));
  const plans:string[]=[];
  for(const j of pending){
   if(!j.executionPlan)continue;
   try{
    const plan=JSON.parse(readFileSync(j.executionPlan,'utf8')),stateFile=join(plan.outputDir,'flow-run.json');
    const before=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')).items?.[j.id]:null;
    if(!['submitted','submission_intent','uncertain','available'].includes(before?.status)){markUnsubmitted(dir,j.id);continue;}
    if(before.status==='available'&&before.file){if(j.kind==='image')recordImage(dir,j.id,before.file);else completeCollectedVideo(dir,j.id,before);continue;}
    plans.push(j.executionPlan);
   }catch(e){recordCollectionError(dir,j.id,'Não foi possível ler a prova desta tentativa: '+(e as Error).message,true);}
  }
  if(!plans.length)return;
  try{
   const target=await tabFor(w,0);
   await inCollectionLane(()=>inFlowLane(target,async()=>{
    const org=w.plan.organization;
    await controlOn(target,'ensure-collection','--expert',org.expertProjectName,'--reference',w.ref,'--project',org.projectUrl);
    // Uma varredura por coleção atende todos os itens; o índice do coletor persiste os assets já examinados.
    for(const kind of ['image','video'] as const){
     const group=pending.filter(j=>j.kind===kind&&j.executionPlan&&plans.includes(j.executionPlan));
     if(!group.length)continue;
     try{
      const retry=group.some(j=>j.retryCollection);beginCollectionProbe(dir,group.map(j=>j.id));
      const outcome=await command([PYTHON,join(FLOW,'scripts/flow_collect_videos.py'),...group.map(j=>j.executionPlan!),'--kind',kind==='image'?'still':'shot','--cycles','1',...(retry?['--retry-downloads']:[])],target);
      for(const failure of outcome.failures??[]){const failed=group.find(j=>failure.item===w.ref+':'+j.id);if(!failed)continue;const current=readWorkflow(dir)!.jobs.find(j=>j.id===failed.id)!;
       if(failure.kind==='provider_refused'){if(current.executionPlan===failed.executionPlan&&['submitted','uncertain'].includes(current.status))recordProviderRefusal(dir,failed.id,String(failure.error),String(failure.submissionTag));}
       else recordCollectionError(dir,failed.id,String(failure.error),failure.terminal===true);}
     }catch(e){for(const j of group)recordCollectionError(dir,j.id,(e as Error).message);}
     finally{for(const j of group){
      try{
      const plan=JSON.parse(readFileSync(j.executionPlan!,'utf8')),file=join(plan.outputDir,'flow-run.json');
      const result=JSON.parse(readFileSync(file,'utf8')).items?.[j.id];
      if(result?.status!=='available'||!result.file)continue;
      const current=readWorkflow(dir)!.jobs.find(x=>x.id===j.id)!;
      if(!['submitted','uncertain'].includes(current.status)&&!current.collectionError)continue;
      if(j.kind==='image')recordImage(dir,j.id,result.file);else completeCollectedVideo(dir,j.id,result);
      }catch(e){recordCollectionError(dir,j.id,(e as Error).message,true);}
     }}
    }
   }));
  }catch(e){console.error('Coleta pendente em lote:',w.ref,w.slug,(e as Error).message);}
 }
 private async run(dir:string){
  const w=readWorkflow(dir);if(!w?.authorized)return;
  for(const j of w.jobs.filter(j=>j.status==='uncertain'&&j.provider==='chatgpt')){
   const receiptFile=join(dir,'producao',w.runId,'requests',j.id,'tentativa-'+j.attempt,'receipt.json');
   if(existsSync(receiptFile)){const receipt=JSON.parse(readFileSync(receiptFile,'utf8'));if(fileHash(receipt.file)===receipt.sha256)recordImage(dir,j.id,receipt.file);}
  }
  // All ready submissions precede collection. No previous render or audio audit gates the next item.
  await dispatchReady({next:()=>this.nextJob(dir,'image'),execute:j=>this.execute(dir,j),concurrency:w.provider==='chatgpt'?2:1});
  await this.drainVideos(dir);
  await this.collect(dir);
  // Images that returned from ChatGPT already unlocked video; Flow images wait for a user decision.
 }
 private nextJob(dir:string,kind:Job['kind']){const limit=readWorkflow(dir)?.jobs.length??0;for(let n=0;n<=limit&&!this.stopped;n++){try{return claimJob(dir,kind);}catch(e){console.error((e as Error).message);}}return null;}
 // Antes de enviar vídeos: um único drop com todas as imagens liberadas; o envio de cada vídeo só vincula o asset.
 private uploadBases(dir:string){const next=(this.uploads.get(dir)??Promise.resolve()).then(()=>this.uploadPending(dir)).catch(e=>console.error('Upload em lote:',(e as Error).message));this.uploads.set(dir,next);return next;}
 private async uploadPending(dir:string){
  const w=readWorkflow(dir);if(!w?.authorized)return;
  const sent=this.sent.get(dir)??new Set<string>();this.sent.set(dir,sent);
  const files=new Map<string,string>();for(const v of w.jobs)if(v.kind==='video'&&v.status==='queued'){const i=w.jobs.find(x=>x.id===v.dependency);if(i?.output&&i.sha256&&!sent.has(i.sha256))files.set(i.sha256,i.output);}
  if(!files.size)return;
  const org=w.plan.organization,target=await tabFor(w,0);
  const result=await inFlowLane(target,()=>controlOn(target,'upload-images','--expert',org.expertProjectName,'--reference',w.ref,'--project',org.projectUrl,'--slug',w.slug,'--root',join(FLOW,'outputs',w.ref,w.slug,'workflow-'+w.runId,'upload-lote'),...files.values()));
  if(result.unconfirmed?.length)console.error('Upload em lote sem confirmação:',result.unconfirmed.join(', '));else for(const hash of files.keys())sent.add(hash);
 }
 private async drainVideos(dir:string){resolveSharedVideos(dir);await this.uploadBases(dir);await dispatchReady({next:()=>this.nextJob(dir,'video'),execute:(j,lane)=>this.execute(dir,j,lane),concurrency:FLOW_TABS});}
}
import {completeCollectedVideo} from './production-workflow';
