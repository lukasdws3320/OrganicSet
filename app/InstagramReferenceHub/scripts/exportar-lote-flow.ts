import {fabricatePrompts} from '../server/prompt-factory';
import {Database} from 'bun:sqlite';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename,dirname, join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {DB_FILE} from '../server/db';
import {libraryRoot} from '../server/library';
import {getReplicacao} from '../server/replicacoes';
import {montarLoteFlow} from '../server/lote-flow';
import {loadExpertProduction} from '../server/expert-production';
import {exigirContextoVocal, type ReplicacaoV2} from '../server/replicacao-prompts';
import {revisarCadencia} from '../server/production-timing';

try{
 const {values}=parseArgs({args:Bun.argv.slice(2),options:{id:{type:'string'},avatar:{type:'string'},output:{type:'string'},credits:{type:'string'},shots:{type:'string'},version:{type:'string'},'flow-expert':{type:'string'},'flow-project':{type:'string'}}});
 if(!values.id||!values.output||values.credits===undefined)throw Error('Uso: bun run scripts/exportar-lote-flow.ts --id REF--expert --output /pasta/plano.json --credits LIMITE [--avatar /arquivo quando não há perfil] [--shots IDs] [--version V1]');
 const root=libraryRoot(),db=new Database(join(root,DB_FILE),{readonly:true});
 try{
  const current=getReplicacao(db,root,values.id);
  if(!current.replicacao||!current.slug)throw Error('Selecione uma replicação por expert');
  if(current.bloqueada)throw Error(current.problemas.filter(p=>p.nivel==='erro').map(p=>p.mensagem).join('; '));
  const profile=loadExpertProduction(root,current.replicacao);
  const avatarPath=profile?.contactSheet.path||(values.avatar?resolve(values.avatar):null);
  if(!avatarPath)throw Error('Vincule o contact sheet no perfil de produção deste expert antes de exportar');
  if(profile&&values.avatar&&createHash('sha256').update(readFileSync(resolve(values.avatar))).digest('hex')!==profile.contactSheet.sha256)throw Error('Avatar informado difere do contact sheet vinculado ao expert');
  if(!profile&&basename(avatarPath).replace(/\.[^.]+$/,'')!==current.replicacao.avatar.replace(/\.[^.]+$/,''))throw Error('Contact sheet não corresponde ao avatar cadastrado; registre o perfil deste expert');
  const refDir=join(root,'replicacoes',current.ref),file=join(refDir,current.slug,'replicacao.json');
  const rep=current.replicacao as ReplicacaoV2;
  if(profile&&/^Veo/i.test(rep.engine)&&!/^Veo/i.test(profile.flow.videoModel))throw Error('Replicação Veo conflita com o modelo do perfil Flow; resolver o destino antes de exportar.');
  exigirContextoVocal(rep,values.version);
  const transcript=JSON.parse(readFileSync(join(refDir,'transcricao.json'),'utf8'));
  if(!Array.isArray(transcript.palavras))throw Error('Cadência exige timestamps por palavra da transcrição.');
  const versao=values.version??rep.copy.ativa;
  const atual={...rep,copy:{...rep.copy,ativa:versao}};
  const revisao=revisarCadencia(atual,transcript.palavras);
  if(revisao.bloqueada)throw Error(revisao.problemas.join('; '));
  const tempos=Object.fromEntries(rep.shots.map(s=>{
   const rev=revisarCadencia({...atual,shots:[s]},transcript.palavras);
   if(rev.bloqueada||rev.groups[0]?.duration==null)throw Error(rev.problemas.join('; '));
   return [s.id,{duration:rev.groups[0].duration,speechSeconds:rev.groups[0].speechSeconds}];
  }));
  for(const shot of rep.shots){
   const bundle=fabricatePrompts(rep,shot,versao);
   if(!bundle.layers.some(layer=>layer.segment))continue;
   for(const [index,segment] of (shot.composicaoSegmentos??[]).entries()){
    const sub=structuredClone(atual);sub.shots=[{...shot,janela:[segment.ini,segment.fim],fala:segment.fala}];sub.copy.versoes.find(v=>v.id===versao)!.falas[shot.id]=segment.fala;
    const measured=revisarCadencia(sub,transcript.palavras);
    if(measured.bloqueada||!measured.groups[0]?.duration)throw Error('Cadência por segmento: '+measured.problemas.join('; '));
    tempos[`${shot.id}:segment-${index+1}`]={duration:measured.groups[0].duration,speechSeconds:measured.groups[0].speechSeconds};
   }
  }
  const output=resolve(values.output);
  const plan=montarLoteFlow(rep,current.shots,{refDir,avatarPath,outputDir:join(dirname(output),'media'),maxCredits:Number(values.credits),replicationSha256:createHash('sha256').update(readFileSync(file)).digest('hex'),replicationPath:file,analysisPath:join(refDir,'analise.json'),version:values.version,shots:values.shots?.split(','),tempos,transcript:{path:join(refDir,'transcricao.json'),sha256:createHash('sha256').update(readFileSync(join(refDir,'transcricao.json'))).digest('hex'),palavras:transcript.palavras}});
  if(profile){
   if(values['flow-expert']&&values['flow-expert']!==profile.flow.projectName||values['flow-project']&&values['flow-project']!==profile.flow.projectUrl)throw Error('Projeto informado difere do perfil do expert');
   const {projectName,projectUrl,...settings}=profile.flow;
   Object.assign(plan.settings,settings);
   Object.assign(plan.source,{expertProfilePath:join(root,'experts',current.slug,'producao.json'),expertProfileSha256:createHash('sha256').update(readFileSync(join(root,'experts',current.slug,'producao.json'))).digest('hex')});
  }
  const organization={expertProjectName:values['flow-expert']??profile?.flow.projectName??current.replicacao.expert,collectionName:current.ref,...(values['flow-project']||profile?.flow.projectUrl?{projectUrl:values['flow-project']||profile?.flow.projectUrl}:{})};
  if(!organization.expertProjectName.trim())throw Error('Nome do projeto Flow ausente');
  if(values['flow-project']&&!/^https:\/\/flow\.google\.com\/project\/[A-Za-z0-9-]+$/.test(values['flow-project']))throw Error('Use a URL raiz do projeto Flow existente');
  const identity={expertSlug:current.slug,avatarName:current.replicacao.avatar,contactSheet:{path:avatarPath,sha256:createHash('sha256').update(readFileSync(avatarPath)).digest('hex')}};
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({...plan,organization,identity,...(profile?.audio?{audio:profile.audio}:{})},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({path:output,shots:plan.shots.length,stills:plan.stills.length,assets:plan.assets.length,timing:plan.shots.map(s=>({shot:s.id,source:s.sourceDuration,requested:s.requestedDuration,effective:s.duration})),generated:false}));
 }finally{db.close();}
}catch(error){console.error((error as Error).message);process.exitCode=1;}
