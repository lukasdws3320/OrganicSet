import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {getReplicacao,resolveReplicacaoId} from './replicacoes';
import {getRef,HttpError,type Ctx} from './refs';
import {basename} from 'node:path';
import {promptDoStill} from './lote-flow';
import {archiveWorkflow,authorizeRetake,switchVideoModel,authorizeWorkflow,markMissingResult,productionNextAction,reopenCollection,requeueNeverSubmitted,updateImagePrompt,createWorkflow,decideImage,imageBases,readWorkflow,recoverInterrupted,recordImage,rebindRenamedSources,requeueUnsubmitted,type Provider} from './production-workflow';
import {ProductionRunner} from './production-runner';
import {productionPackage} from './production-package';

export class ProductionService{
 runner=new ProductionRunner();
 private creating=new Map<string,{provider:Provider|undefined;promise:Promise<unknown>}>();
 constructor(private ctx:Ctx){}
 directory(id:string){const resolved=resolveReplicacaoId(this.ctx.db,this.ctx.root,id);if(!resolved.slug)throw new HttpError(400,'Selecione o avatar desta produção');return join(this.ctx.root,'replicacoes',resolved.ref,resolved.slug);}
 state(id:string){
  const dir=this.directory(id),w=readWorkflow(dir);
  return w?{...w,packageUrl:existsSync(join(dir,'producao',w.runId,'manual','pacote.zip'))?`/api/replicacoes/${id}/execucao/pacote`:null,imageBases:imageBases(w),nextAction:productionNextAction(w),editingNote:'Pequenas sobras de fala no início/fim são ajustes de edição. Não geram retake automático.',jobs:w.jobs.map(j=>({...j,mediaUrl:j.output?`/api/replicacoes/${id}/execucao/${j.id}/media`:null}))}:{schema:'irh-production-workflow/v1',jobs:[],questions:[{field:'provider',label:'Como preparar as imagens?',choices:['manual','chatgpt','flow']}],editingChoices:['ffmpeg','opencut']};
 }
 async start(id:string,input:{provider?:Provider;maxCredits?:number;authorized?:boolean;editing?:'ffmpeg'|'opencut';newVersion?:boolean}){
  const dir=this.directory(id),pending=this.creating.get(dir);if(pending){if(input.provider&&pending.provider!==input.provider)throw new HttpError(409,'Já há um pedido de criação desta produção');return pending.promise;}
  const promise=this.build(id,input);this.creating.set(dir,{provider:input.provider,promise});try{return await promise;}finally{this.creating.delete(dir);}
 }
 private async build(id:string,input:{provider?:Provider;maxCredits?:number;authorized?:boolean;editing?:'ffmpeg'|'opencut';newVersion?:boolean}){
  const dir=this.directory(id);if(input.newVersion&&readWorkflow(dir)){if(!input.provider)throw new HttpError(400,'Informe o gerador da nova versão');try{archiveWorkflow(dir);}catch(e){throw new HttpError(409,(e as Error).message);}}
  const old=readWorkflow(dir);if(old){if(input.provider&&input.provider!==old.provider)throw new HttpError(409,'Esta produção já usa '+old.provider+'; retome o trabalho existente');if(input.authorized===true){rebindRenamedSources(dir);requeueUnsubmitted(dir);authorizeWorkflow(dir,input.maxCredits??old.plan.settings.maxCredits);}if(readWorkflow(dir)!.authorized)this.runner.wake(dir);return this.state(id);}
  if(!input.provider)return this.state(id);
  if(!['manual','chatgpt','flow'].includes(input.provider))throw new HttpError(400,'Gerador de imagem inválido');
  if(!Number.isFinite(input.maxCredits)||input.maxCredits!<0)throw new HttpError(400,'Informe o teto de créditos Flow (0 apenas para preparar)');
  const current=getReplicacao(this.ctx.db,this.ctx.root,id);
  if(!current.replicacao||current.bloqueada)throw new HttpError(409,'Preparação da referência ainda não concluída; retome a fila de análise existente');
  const draft=join(resolve(import.meta.dir,'../../GoogleFlowMCP/outputs'),current.ref,current.slug!,'workflow-base-'+randomUUID());mkdirSync(draft,{recursive:true});
  const planPath=join(draft,'export-base.json');
  const p=Bun.spawn([process.execPath,resolve(import.meta.dir,'../scripts/exportar-lote-flow.ts'),'--id',id,'--output',planPath,'--credits',String(input.maxCredits)],{env:{...process.env,IRH_LIBRARY:this.ctx.root},stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
  if(code!==0)throw new HttpError(409,(err||out).trim());
  const plan=JSON.parse(readFileSync(planPath,'utf8'));createWorkflow(dir,plan,{provider:input.provider,authorized:input.authorized===true,editing:input.editing??'ffmpeg'});
  const reference=getRef(this.ctx,current.ref);writeFileSync(join(dir,'legenda-original.txt'),reference?.caption??'');
  if(input.provider==='manual'){
   if(!reference?.video_path)throw new HttpError(409,'Vídeo original ausente');
   await productionPackage(dir,{path:join(this.ctx.root,reference.video_path),caption:reference.caption});
  }
  if(input.authorized)this.runner.wake(dir);return this.state(id);
 }
 decision(id:string,item:string,input:{approved:boolean;reason?:string}){const dir=this.directory(id);if(typeof input.approved!=='boolean')throw new HttpError(400,'Informe aprovação ou reprovação');try{decideImage(dir,item,input.approved,input.reason);}catch(e){throw new HttpError(400,(e as Error).message);}this.runner.wake(dir);return this.state(id);}
 // Várias aprovações antes de um único wake: as imagens liberadas sobem numa leva só.
 approveImages(id:string,items:string[]){const dir=this.directory(id);if(!items.length)throw new HttpError(400,'Informe as imagens aprovadas');try{for(const item of items)decideImage(dir,item,true);}catch(e){throw new HttpError(400,(e as Error).message);}finally{this.runner.wake(dir);}return this.state(id);}
 collect(id:string){const dir=this.directory(id);if(!readWorkflow(dir))throw new HttpError(404,'Produção ainda não iniciada');reopenCollection(dir);this.runner.wake(dir);return this.state(id);}
 // Nova tentativa paga fora da recuperação: só com a autorização do usuário registrada no histórico.
 authorizeAttempt(id:string,item:string,input:{motivo?:string;autorizacao?:string;duracao?:number}){const dir=this.directory(id);try{authorizeRetake(dir,item,{reason:String(input.motivo??''),authorization:String(input.autorizacao??''),...(input.duracao===undefined?{}:{duration:Number(input.duracao)})});}catch(e){throw new HttpError(409,(e as Error).message);}this.runner.wake(dir);return this.state(id);}
 switchModel(id:string,input:{modelo?:string;autorizacao?:string;motivo?:string}){const dir=this.directory(id);try{switchVideoModel(dir,{model:String(input.modelo??''),authorization:String(input.autorizacao??''),reason:String(input.motivo??'')});}catch(e){throw new HttpError(409,(e as Error).message);}return this.state(id);}
 // Envio incerto sem mídia depois da coleta: uma nova tentativa, com a evidência no registro.
 retry(id:string,item:string,evidence:string){const dir=this.directory(id);try{if(!requeueNeverSubmitted(dir,item,evidence))markMissingResult(dir,item,evidence);}catch(e){throw new HttpError(409,(e as Error).message);}this.runner.wake(dir);return this.state(id);}
 refreshImagePrompts(id:string,items:string[]){const dir=this.directory(id),w=readWorkflow(dir);if(!w)throw new HttpError(404,'Produção ainda não iniciada');const stored=JSON.parse(readFileSync(w.plan.source.replicationPath,'utf8')),sheet=w.plan.identity?.contactSheet?.path,rep=sheet?{...stored,avatar:basename(sheet)}:stored;try{if(rep.formato==='REACT + ANIMAÇÃO')throw Error('Prompts por camadas nascem do plano e seus IDs não são os da replicação; abra uma nova versão');for(const item of items){const still=rep.stills.find((s:any)=>s.id===item);if(!still)throw Error('Imagem fora da replicação: '+item);updateImagePrompt(dir,item,promptDoStill(rep,still).replace(/\s*Nomeie a imagem gerada com o nome → [^\s]+\./,''));}}catch(e){throw new HttpError(409,(e as Error).message);}this.runner.wake(dir);return this.state(id);}
 package(id:string){const dir=this.directory(id),w=readWorkflow(dir);if(!w)throw new HttpError(404,'Pacote ainda não preparado');const file=join(dir,'producao',w.runId,'manual','pacote.zip');if(!existsSync(file))throw new HttpError(404,'Pacote manual não preparado');return file;}
 async upload(id:string,item:string,bytes:Uint8Array){if(bytes.length>30*1024*1024)throw new HttpError(413,'Imagem excede 30 MB');const dir=this.directory(id),file=join(dir,'upload-'+randomUUID());writeFileSync(file,bytes);try{recordImage(dir,item,file);this.runner.wake(dir);return this.state(id);}finally{const {unlinkSync}=await import('node:fs');unlinkSync(file);}}
 media(id:string,item:string){const j=readWorkflow(this.directory(id))?.jobs.find(j=>j.id===item);if(!j?.output||!existsSync(j.output))throw new HttpError(404,'Mídia ainda não disponível');return j.output;}
 resume(){const root=join(this.ctx.root,'replicacoes');if(!existsSync(root))return;for(const ref of readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('REF-')))for(const slug of readdirSync(join(root,ref.name),{withFileTypes:true}).filter(e=>e.isDirectory())){const dir=join(root,ref.name,slug.name);if(readWorkflow(dir)){recoverInterrupted(dir);this.runner.wake(dir);}}}
 stop(){this.runner.stop();}
}
