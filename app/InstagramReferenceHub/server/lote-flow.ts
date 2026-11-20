import {numerosPorExtenso} from './numeros-fala';
import {fabricatePrompts} from './prompt-factory';
import {readFileSync, realpathSync, statSync} from 'node:fs';
import {basename, isAbsolute, join, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import {anexosStill, duracaoGerar, falaDe, nomeShot, nomeStill, problemas, stillPrompt, videoPrompt, type ReplicacaoV2} from './replicacao-prompts';

const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
export function duracaoOmni(sourceDuration:number,words:number,requested:number){
 const speechEstimate=words/3.2,minimum=Math.max(sourceDuration,speechEstimate);
 if(![sourceDuration,words,requested].every(Number.isFinite)||sourceDuration<=0||words<0||requested<=0)throw Error('Duração inválida');
 if(requested+0.01<minimum)throw Error('Duração solicitada insuficiente para a janela/fala');
 const duration=[4,6,8,10].find(n=>n>=Math.max(minimum,requested));
 if(!duration)throw Error('Shot excede o contrato Omni de 10s; resegmentar sem cortar palavras');
 return {duration,speechEstimate,minimum};
}
export type TempoMedido={duration:number;speechSeconds:number};
export type OpcoesLote={refDir:string;avatarPath:string;outputDir:string;maxCredits:number;replicationSha256:string;replicationPath?:string;analysisPath?:string;version?:string;shots?:string[];tempos?:Record<string,TempoMedido>;transcript?:{path:string;sha256:string;palavras:{w:string;ini:number;fim:number}[]}};

function measuredEvidence(transcript:NonNullable<OpcoesLote['transcript']>,speech:string,window:[number,number]){
 const ws=transcript.palavras,indices=ws.map((w,i)=>w.ini>=window[0]-.03&&w.fim<=window[1]+.03?i:-1).filter(i=>i>=0);
 if(!speech.trim())return undefined;
 if(!indices.length)throw Error('Fala sem timestamps medidos nesta janela');
 const a=indices[0],b=indices.at(-1)!+1,literal=ws.slice(a,b).map(w=>w.w).join(' ').replace(/\s+([,.!?…])/g,'$1').trim();
 if(literal!==speech)throw Error('Fala adaptada exige medição própria; não herdar timestamps da fonte');
 return {kind:'source-speech',transcriptPath:transcript.path,transcriptSha256:transcript.sha256,wordRange:[a,b],speechSeconds:ws[b-1].fim-ws[a].ini};
}

/** Só prepara dados: nunca abre navegador, gera mídia ou modifica fontes/status. */
// Apresentador no mesmo plano e cenário usa uma imagem-base só: gesto e fala mudam no vídeo, não pedem outra imagem.
export function basesDeApresentador(formato:string,stills:{id:string;angulo?:unknown;estado?:unknown}[]){
 const bases=new Map<string,string>();if(!/EXPERT$/.test(formato))return bases;
 const leitura=(st:{estado?:unknown})=>{const e:any=typeof st.estado==='string'?(()=>{try{return JSON.parse(st.estado as string);}catch{return [st.estado];}})():st.estado;return {texto:String(e?.[0]??''),objetos:JSON.stringify([...(Array.isArray(e?.[1])?e[1]:[])].sort())};};
 let base:(typeof stills)[number]|null=null;
 for(const st of stills){
  const igual=base&&JSON.stringify(base.angulo)===JSON.stringify(st.angulo)&&(/^mesmo plano/i.test(leitura(st).texto)||leitura(base).objetos===leitura(st).objetos);
  if(igual)bases.set(st.id,base!.id);else{base=st;bases.set(st.id,st.id);}
 }
 return bases;
}
// Plate de REACT não depende do frame (só contexto da reação): mesmo pedido, fora a menção ao frame, é a mesma base.
export function basesDePlate(rep:ReplicacaoV2,stills:ReplicacaoV2['stills']){
 const bases=new Map<string,string>(),first=new Map<string,string>();
 for(const st of stills){const key=stillPrompt(rep,st).replace(/Nomeie a imagem gerada com o nome → [^\s]+\./,'').split(basename(st.frame)).join('@frame');if(!first.has(key))first.set(key,st.id);bases.set(st.id,first.get(key)!);}
 return bases;
}
// Prompt do still como o plano envia; atualizar prompts passa por aqui para não perder a instrução de identidade.
export function promptDoStill(rep:ReplicacaoV2,st:ReplicacaoV2['stills'][number]){
 const canonical=stillPrompt(rep,st);if(anexosStill(rep,st).some(a=>a.papel==='contact sheet do avatar'))return canonical;
 return `${canonical} Use @${rep.avatar} como referência de identidade e estilo apenas para as partes humanas já visíveis, como mãos. Se não houver partes humanas, use somente o estilo visual. Preserve o enquadramento e o ângulo do frame original; não acrescente rosto, tronco ou corpo quando estiverem fora do quadro.`;
}
export function montarLoteFlow(original:ReplicacaoV2,seg:any,opts:OpcoesLote){
 if(!Number.isFinite(opts.maxCredits)||opts.maxCredits<0)throw Error('Limite de créditos inválido');
 if(!isAbsolute(opts.outputDir)||!isAbsolute(opts.avatarPath))throw Error('Use caminhos absolutos para saída e avatar');
 const version=opts.version??original.copy.ativa;
 if(!original.copy.versoes.some(v=>v.id===version))throw Error('Versão de copy inexistente');
 if(/seedance/i.test(original.engine))throw Error('Exportação Omni requer replicação com contrato Flow/Veo; não converter slots Seedance silenciosamente');
 const errors=problemas(original,seg).filter(p=>p.nivel==='erro');
 if(errors.length)throw Error(errors.map(p=>`${p.codigo}: ${p.mensagem}`).join('; '));
 const selected=opts.shots??original.shots.map(s=>s.id);
 if(!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!original.shots.some(s=>s.id===id)))throw Error('Seleção de SHOT inválida');
 const shotData=original.shots.filter(s=>selected.includes(s.id));
 if(shotData.some(s=>s.still_final))throw Error('Este fluxo Omni usa um quadro inicial; still final requer rota própria');
 const avatarPath=realpathSync(opts.avatarPath);
 const rep={...original,avatar:basename(avatarPath)};
 const root=realpathSync(opts.refDir);
 const assets:{id:string;path:string;sha256:string;name:string;role:string}[]=[];
 const add=(path:string,role:string,expected?:string)=>{
  const absolute=realpathSync(path);
  if(role==='frame de referência'&&!absolute.startsWith(root+sep))throw Error('Frame fora da referência');
  if(!statSync(absolute).isFile())throw Error('Anexo não é arquivo');
  const sha256=hash(readFileSync(absolute)),name=basename(absolute);
  if(role==='frame de referência'&&name!==basename(path))throw Error(`Nome do frame diverge do arquivo real: ${basename(path)}`);
  if(expected&&sha256!==expected)throw Error(`Hash divergente: ${name}`);
  const existing=assets.find(a=>a.name===name);
  if(existing&&existing.sha256!==sha256)throw Error(`Colisão de nome entre anexos: ${name}`);
  if(existing)return existing.id;
  const id=`asset-${assets.length+1}`;assets.push({id,path:absolute,sha256,name,role});return id;
 };
 const usados=[...new Set(shotData.map(s=>s.still))].map(id=>rep.stills.find(s=>s.id===id)!);
 const baseStill=rep.formato==='REACT'?basesDePlate(rep,usados):basesDeApresentador(rep.formato,usados);
 const baseOf=(id:string)=>baseStill.get(id)??id;
 const stills=[...new Set(shotData.map(s=>baseOf(s.still)))].map(id=>{
  const st=rep.stills.find(s=>s.id===id)!;
  const attachments=anexosStill(rep,st);
  const needsAvatar=!attachments.some(a=>a.papel==='contact sheet do avatar');
  if(needsAvatar)attachments.push({slot:`@${rep.avatar}`,arquivo:avatarPath,papel:'contact sheet do avatar'});
  const inputs=attachments.map(a=>add(a.papel==='frame de referência'?resolve(root,a.arquivo):avatarPath,a.papel,a.papel==='frame de referência'?st.frame_sha256:undefined));
  const prompt=promptDoStill(rep,st);
  return {id,prompt,inputs,output:join(opts.outputDir,nomeStill(rep,id))};
 });
 const shots=shotData.map(s=>{
  const speech=falaDe(rep,s,version),words=speech.trim()?speech.trim().split(/\s+/).length:0;
  const sourceDuration=Number((s.janela[1]-s.janela[0]).toFixed(6));
  const medido=opts.tempos?.[s.id];
  if(opts.tempos&&!medido)throw Error(`Medição de cadência ausente para ${s.id}`);
  if(medido&&(!Number.isFinite(medido.speechSeconds)||medido.speechSeconds<0||!(/omni|flow/i.test(rep.engine)?[4,6,8,10]:[4,6,8]).includes(medido.duration)||medido.speechSeconds>medido.duration+.01))throw Error(`Cadência medida incompatível para ${s.id}; resegmentar sem cortar palavras`);
  const requestedDuration=medido?.duration??duracaoGerar(s,speech,rep),timing=medido?{duration:medido.duration,speechEstimate:medido.speechSeconds}:duracaoOmni(sourceDuration,words,requestedDuration);
  const speechMode=rep.formato==='RECEITA POV'||s.tipo==='inserto'&&rep.formato!=='REACT'?'post-production':speech?'generated':'none';
  const medida=rep.copy.versoes.find(v=>v.id===version)?.medicoes?.[s.id];
  const timingEvidence=opts.transcript&&speechMode==='generated'?(medida?{kind:'adapted-speech',speechSeconds:medida.segundos,source:medida.fonte}:measuredEvidence(opts.transcript,speech,s.janela)):undefined;
  return {timingEvidence,id:s.id,still:baseOf(s.still),sourceWindow:s.janela,sourceDuration,requestedDuration,duration:timing.duration,speechEstimate:timing.speechEstimate,durationReason:medido?`Fala medida em ${medido.speechSeconds}s; janela de montagem ${sourceDuration}s; preset ${timing.duration}s. Revisar ação e áudio do resultado.`:`Estimativa legada: janela ${sourceDuration}s; ${words} palavras / 3,2; revisar cadência antes da execução.`,speech,spokenSpeech:numerosPorExtenso(speech),speechMode,prompt:videoPrompt(rep,s,version),output:join(opts.outputDir,nomeShot(rep,s.id,version))};
 });
 let outputStills=stills,outputShots=shots;
 const narration:unknown[]=[];
 if(rep.formato==='REACT + ANIMAÇÃO'){
  const plates=new Map<string,string>();
  const expandedStills:typeof stills=[],expandedShots:(typeof shots[number]&{layer:string;sourceShots:string[];sourceTakes:string[]})[]=[];
  for(const [index,sourceShot] of shotData.entries()){
   const bundle=fabricatePrompts(rep,sourceShot,version),baseShot=shots[index];
   narration.push(...bundle.narration);
   for(const layer of bundle.layers){
    const measured=layer.segment?opts.tempos?.[`${sourceShot.id}:segment-${layer.segment}`]:null;
    if(layer.segment&&!measured)throw Error('Medição de cadência por segmento ausente');
    const n=expandedShots.length+1,id=`SHOT${String(n).padStart(2,'0')}`;
    const originalStill=rep.stills.find(st=>st.frame===layer.attachments.find(a=>a.role==='frame')?.file)!;
    // Plate de react invariável: mesmo pedido de imagem (fora a menção ao frame de contexto) = mesma base para várias falas.
    // Enquadramento/pose diferente muda o pedido e gera outra base; fundos de estados distintos mantêm bases próprias; entre avatares, fundos idênticos são compartilhados pelo workflow.
    const plateKey=layer.layer==='react'?layer.nanobanana.split(basename(originalStill.frame)).join('@frame'):null;
    let stillId=plateKey?plates.get(plateKey):undefined;
    if(!stillId){
     stillId=`STILL${String(expandedStills.length+1).padStart(2,'0')}`;if(plateKey)plates.set(plateKey,stillId);
     const inputs=layer.attachments.map(a=>add(a.role==='frame'?resolve(root,a.file):avatarPath,a.role==='frame'?'frame de referência':'contact sheet do avatar',a.role==='frame'?originalStill.frame_sha256:undefined));
     expandedStills.push({id:stillId,prompt:layer.nanobanana,inputs,output:join(opts.outputDir,nomeStill(rep,stillId))});
    }
    const actionWindow=layer.sourceWindow??sourceShot.janela;
    const actionSeconds=Number((actionWindow[1]-actionWindow[0]).toFixed(6));
    const actionDuration=layer.audio!=='dialogue'?(/omni|flow/i.test(rep.engine)?[4,6,8,10]:[4,6,8]).find(n=>n>=actionSeconds):undefined;
    if(layer.audio!=='dialogue'&&!actionDuration)throw Error(`${sourceShot.id}: ação de fundo não cabe no preset; separar os cortes da referência`);
    expandedShots.push({...baseShot,id,still:stillId,layer:layer.layer,sourceShots:[sourceShot.id],sourceTakes:[originalStill.take],timingEvidence:layer.audio==='dialogue'&&opts.transcript?measuredEvidence(opts.transcript,layer.speech??baseShot.speech,layer.sourceWindow??sourceShot.janela):undefined,...(layer.sourceWindow?{sourceWindow:layer.sourceWindow,sourceDuration:layer.sourceWindow[1]-layer.sourceWindow[0]}:{}),...(measured?{duration:measured.duration,requestedDuration:measured.duration,speechEstimate:measured.speechSeconds}:{}),...(actionDuration?{duration:actionDuration,requestedDuration:actionDuration,speechEstimate:0,durationReason:`Ação sem fala medida na janela ${actionSeconds}s; preset ${actionDuration}s. A cadência do comentário pertence à camada react.`}:{}),speech:layer.audio==='dialogue'?(layer.speech??baseShot.speech):'',spokenSpeech:layer.audio==='dialogue'?numerosPorExtenso(layer.speech??baseShot.speech):'',speechMode:layer.audio==='dialogue'?'generated':'none',prompt:layer.video,output:join(opts.outputDir,nomeShot(rep,id,version))});
   }
  }
  outputStills=expandedStills;outputShots=expandedShots;
 }
 return {schema:'flow-replication-plan/v1' as const,ref:rep.ref,expert:rep.expert,version,
  source:{analysisSha256:rep.analise_sha256,analysisPath:opts.analysisPath,replicationSha256:opts.replicationSha256,replicationPath:opts.replicationPath,video:seg.video,engine:rep.engine},
  settings:{imageModel:'🍌 Nano Banana 2.1',videoModel:/^Veo/i.test(rep.engine)?rep.engine.replace(/ Lite$/i,' - Lite'):'Omni 1.1 Flash',videoMode:'Frames',aspectRatio:'9:16',resolution:'720p',count:1,maxCredits:opts.maxCredits},
  assets,stills:outputStills,shots:outputShots,outputDir:opts.outputDir,
  editing:{autoTrim:false,narration,note:'Duração da referência é janela de montagem; não cortar o gerado nela automaticamente. Conferir fala completa e ação antes de ajustar o ritmo.'},
  warnings:problemas(rep,seg).filter(p=>p.nivel==='aviso').map(p=>p.mensagem)};
}
