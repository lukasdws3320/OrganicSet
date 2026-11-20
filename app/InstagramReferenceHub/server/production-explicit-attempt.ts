// Tentativa extra por autorização EXPLÍCITA do usuário (uma por chave de autorização), depois de erro registrado.
// Mesmo padrão de authorizeModelRetry: perfil global intacto, snapshot imutável só com flow.videoModel trocado,
// fala/prompt/imagem/duração/identidade iguais; plano, tentativa, recibo e arquivo anteriores ficam no histórico.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileHash,readWorkflow,saveWorkflow} from './production-workflow';

export const MODELOS_EXPLICITOS=['Veo 3.1 - Fast','Omni 1.1 Flash'];
export function authorizeExplicitAttempt(dir:string,id:string,input:{authorizationKey:string;authorization:string;reason:string;model:string}){
 if(!MODELOS_EXPLICITOS.includes(input.model))throw Error('Modelo fora da lista permitida: '+input.model);
 if(!input.authorizationKey?.trim())throw Error('Informe a chave da autorização');
 if(!input.authorization?.trim())throw Error('Informe a autorização explícita do usuário');
 if(!input.reason?.trim())throw Error('Informe o motivo');
 const w=readWorkflow(dir);if(!w)throw Error('Produção ainda não iniciada');
 const j=w.jobs.find(x=>x.id===id&&x.kind==='video');if(!j)throw Error('Item de produção inexistente');
 if(j.history.some(h=>h.authorizationKey===input.authorizationKey))throw Error('Esta autorização já foi usada');
 if(j.status!=='error')throw Error('Item precisa estar em erro (resultado da tentativa anterior registrado)');
 const image=j.dependency?w.jobs.find(x=>x.id===j.dependency):null;
 if(j.dependency&&image?.status!=='accepted')throw Error('Imagem inicial precisa estar aceita');
 const from=w.plan.source?.expertProfilePath;if(!from||!existsSync(from))throw Error('Perfil de origem ausente');
 const profile=JSON.parse(readFileSync(from,'utf8')),snapshot={...profile,flow:{...profile.flow,videoModel:input.model}};
 const keyHash=createHash('sha256').update(input.authorizationKey).digest('hex').slice(0,12);
 const file=join(dir,'producao-perfil-'+input.model.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+keyHash+'.json'),text=JSON.stringify(snapshot,null,2)+'\n';
 if(existsSync(file)&&readFileSync(file,'utf8')!==text)throw Error('Snapshot de perfil já existe com outro conteúdo; preservar');
 if(!existsSync(file))writeFileSync(file,text);
 j.history.push({attempt:j.attempt,status:'explicit_attempt',previousStatus:j.status,error:j.error,executionPlan:j.executionPlan,receipt:j.receipt,output:j.output,sha256:j.sha256,
  authorizationKey:input.authorizationKey,authorization:input.authorization,reason:input.reason,modelFrom:w.plan.settings?.videoModel,modelTo:input.model,
  profileFrom:from,profileFromSha256:w.plan.source.expertProfileSha256,profileTo:file,planBefore:structuredClone(w.plan),at:new Date().toISOString()});
 w.plan.source.expertProfilePath=file;w.plan.source.expertProfileSha256=fileHash(file);w.plan.settings.videoModel=input.model;
 j.attempt++;for(const k of ['error','executionPlan','receipt','output','sha256','recoveryStartedAt','token'] as const)delete (j as any)[k];
 j.status='queued';
 return saveWorkflow(dir,w,'explicit_attempt',id);
}
