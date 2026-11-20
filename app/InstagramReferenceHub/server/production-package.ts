import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {basename,join} from 'node:path';
import {fileHash,readWorkflow} from './production-workflow';

/** Real attachments and full prompts, independent of local expert history. */
export async function productionPackage(dir:string,source:{path:string;caption:string}){
 const w=readWorkflow(dir);if(!w)throw Error('Produção não preparada');
 const root=join(dir,'producao',w.runId,'manual');mkdirSync(join(root,'anexos'),{recursive:true});
 const assets=new Map<string,{file:string;sha256:string;role:string}>();
 for(const j of w.jobs.filter(j=>j.kind==='image'))for(const input of j.inputs){
  if(fileHash(input.path)!==input.sha256)throw Error('Anexo mudou antes de preparar o pacote');
  if(!assets.has(input.path)){const file='anexos/'+String(assets.size+1).padStart(2,'0')+'_'+basename(input.path);copyFileSync(input.path,join(root,file));assets.set(input.path,{file,sha256:input.sha256,role:input.role});}
 }
 if(!existsSync(source.path))throw Error('Vídeo original ausente');
 mkdirSync(join(root,'original'),{recursive:true});const original='original/'+basename(source.path);copyFileSync(source.path,join(root,original));writeFileSync(join(root,'legenda-original.txt'),source.caption);
 const blocks=w.jobs.map(j=>j.kind==='image'?`${j.id} — imagem inicial\nAnexar nesta ordem: ${j.inputs.map(a=>assets.get(a.path)!.file).join(', ')}\n\nCHATGPT\n${j.toolPrompts?.chatgpt??j.prompt}\n\nNANO BANANA\n${j.toolPrompts?.nanobanana??j.prompt}\n\nSalvar como: ${j.id}_${w.ref}_${w.slug}.png`:`${j.id} — vídeo no Flow\nImagem inicial: ${j.dependency}\nPreset: ${w.plan.shots.find((s:any)=>s.id===j.id)?.duration}s\n${j.prompt}`);
 const prompt=`Pedido autossuficiente: referência ${w.ref}; avatar de destino ${w.slug}; formato e estilo já aplicados nos prompts. Cada imagem usa apenas os anexos enumerados naquele bloco. Frame governa câmera/cenário/ação; identidade governa aparência/roupa. Não gere contact sheet. Faça uma imagem por arquivo. Preserve fala literal e gere vídeos a partir das imagens correspondentes. Pequenas sobras nas bordas da fala serão ajustadas na edição.\n\n${blocks.join('\n\n---\n\n')}`;
 writeFileSync(join(root,'PROMPTS.txt'),prompt);writeFileSync(join(root,'manifesto.json'),JSON.stringify({schema:'irh-video-chat-package/v1',ref:w.ref,expert:w.slug,runId:w.runId,status:'preparado',generated:false,original:{file:original,sha256:fileHash(source.path)},assets:[...assets.values()],caption:'legenda-original.txt',prompts:'PROMPTS.txt'},null,2));
 const zip=join(root,'pacote.zip');const files=['anexos','original','legenda-original.txt','PROMPTS.txt','manifesto.json'];
 // Windows não tem `zip`; o tar do Windows 10+ gera .zip com -a (OrganicSet, 09/11/2026).
 const p=Bun.spawn(process.platform==='win32'?['tar','-a','-c','-f',zip,...files]:['zip','-q','-r',zip,...files],{cwd:root,stdout:'pipe',stderr:'pipe'});const stderr=await new Response(p.stderr).text();if(await p.exited!==0)throw Error('Falha ao empacotar: '+stderr);
 return {zip,prompt,directory:root};
}
