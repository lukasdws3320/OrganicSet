import {numerosPorExtenso} from './numeros-fala';
import {acaoReactGeracao,anexosStill,falaDe,stillPrompt,videoPrompt, type ReplicacaoV2,type ShotV2} from './replicacao-prompts';
export type PromptLayer={speech?:string;spokenSpeech?:string;sourceWindow?:[number,number];segment?:number;layer:'principal'|'fundo'|'react';attachments:{file:string;role:'frame'|'identity'}[];nanobanana:string;chatgpt:string;video:string;duration:number|null;audio:'dialogue'|'action'|'post-production'};
/** Same visual direction, destination-specific attachment syntax. No @voice placeholders. */
export function adaptImagePrompt(prompt:string,attachments:PromptLayer['attachments'],tool:'nanobanana'|'chatgpt'){
 let text=prompt.replace(/Nomeie a imagem gerada com o nome → [^\s]+\./g, "").trim();
 attachments.forEach((a,i)=>{const base=a.file.split(/[\\/]/).pop()!;text=text.replaceAll('@'+base,tool==='chatgpt'?`imagem ${i+1}`:`Referência ${i+1}`);});
 const produto=/^TROCA DE PRODUTO:/.test(text),pontual=/^ALTERAÇÃO PONTUAL:/.test(text);
 const identidade=produto?'somente o produto novo que substitui o antigo (embalagem, rótulo e cores)':pontual?'somente o que entra na cena (a alteração pedida)':'identidade, roupa e estilo do personagem';
 const roles=attachments.map((a,i)=>`${tool==='chatgpt'?'imagem':'Referência'} ${i+1}: ${a.role==='identity'?identidade:(produto||pontual?'a cena original inteira, que deve ser preservada':'câmera, cenário e estado visual da referência')}`).join('; ');
 return `${tool==='chatgpt'?'Crie uma única imagem vertical 9:16.':'Imagem vertical 9:16.'} Anexos: ${roles}. ${text}`;
}
const adapt=adaptImagePrompt;
export function fabricatePrompts(r:ReplicacaoV2,s:ShotV2,version=r.copy.ativa){
 const segments=s.composicaoSegmentos;
 if(r.formato==='REACT + ANIMAÇÃO'&&segments?.length&&new Set(segments.map(x=>JSON.stringify([x.camadas.fundo?.presente,x.camadas.fundo?.estilo,x.camadas.react?.presente,x.camadas.react?.enquadramento]))).size>1){
  if(segments.map(x=>x.fala).filter(Boolean).join(' ')!==falaDe(r,s,version))throw Error('Resolver a segmentação da fala da versão selecionada antes de produzir seus segmentos');
  const narration:{speech:string;sourceWindow:[number,number];voice:string|undefined;mode:string}[]=[];
  const layers:PromptLayer[]=segments.flatMap((x,i)=>{
   const target=r.stills.find(st=>[...(st.sourceWindows??[]),...(st.sourceWindow?[st.sourceWindow]:[])].some(w=>w[0]<=x.ini+.01&&w[1]>x.ini));
   if(!target)throw Error('Frame de origem ausente para o segmento temporal da composição');
   const copy=structuredClone(r);const v=copy.copy.versoes.find(v=>v.id===version)!;v.falas[s.id]=x.fala;
   const sub=fabricatePrompts(copy,{...s,still:target.id,janela:[x.ini,x.fim],fala:x.fala,camadas:x.camadas,composicaoSegmentos:undefined},version);narration.push(...sub.narration);
   return sub.layers.map(layer=>({...layer,segment:i+1,sourceWindow:[x.ini,x.fim] as [number,number]}));
  });
  return {schema:'replication-prompts/v1',ref:r.ref,expert:r.slug,shot:s.id,format:r.formato,style:r.avatar_estilo,version,layers,narration};
 }
 const st=r.stills.find(x=>x.id===s.still);if(!st)throw Error('Imagem inicial sem estado de origem');
 const complex=r.formato==='REACT + ANIMAÇÃO';
 const attachments=anexosStill(r,st).map(a=>({file:a.arquivo,role:(a.papel==='contact sheet do avatar'?'identity':'frame') as 'identity'|'frame'}));
 const main=stillPrompt(r,st);
 const layers:PromptLayer[]=[];
 if(complex){
  const background=s.camadas?.fundo, reaction=s.camadas?.react;
  if(!background||!reaction)throw Error('React + animação exige ações e presença das duas camadas analisadas');
  const frame=[{file:st.frame,role:'frame' as const}];
  const bg=`Recrie @${st.frame.split(/[\\/]/).pop()} somente como fundo de preparo, preservando alimentos, utensílios, enquadramento, estado e estilo do fundo: ${background.estilo}. Remova o avatar sobreposto e as legendas de edição. Não acrescente apresentador ou personagem. ${st.extras??''}`;
  if(background.presente)layers.push({layer:'fundo',attachments:frame,nanobanana:adapt(bg,frame,'nanobanana'),chatgpt:adapt(bg,frame,'chatgpt'),video:`${background.acao}. Preserve a câmera da imagem inicial. Mudanças de etapa ou recipiente seguem os cortes observados na referência, sem transformar um objeto em outro. Sem fala nem música; somente sons naturais da ação.`,duration:s.gerar_s??null,audio:'action'});
  const plate=[{file:st.frame,role:'frame' as const},{file:r.avatar,role:'identity' as const}];
  const image=`Use @${r.avatar} para criar somente o plate do avatar que comenta @${st.frame.split(/[\\/]/).pop()}, sem reproduzir o preparo ou o fundo da referência. Preserve rosto, corpo e roupa da identidade. Fundo uniforme para recorte. ${reaction.enquadramento} Boca neutra no quadro inicial.`;
  const react={...r,formato:'REACT' as const};
  const shot={...s,acao_geracao:acaoReactGeracao(reaction.acao),direcao_camera:reaction.enquadramento};
  if(reaction.presente)layers.push({layer:'react',speech:falaDe(r,s,version),spokenSpeech:numerosPorExtenso(falaDe(r,s,version)),attachments:plate,nanobanana:adapt(image,plate,'nanobanana'),chatgpt:adapt(image,plate,'chatgpt'),video:videoPrompt(react,shot,version),duration:s.gerar_s??null,audio:falaDe(r,s,version)?'dialogue':'action'});
 }else layers.push({layer:'principal',attachments,nanobanana:adapt(main,attachments,'nanobanana'),chatgpt:adapt(main,attachments,'chatgpt'),video:videoPrompt(r,s,version),duration:s.gerar_s??null,audio:r.formato==='RECEITA POV'||s.tipo==='inserto'?'post-production':'dialogue'});
 return {schema:'replication-prompts/v1',ref:r.ref,expert:r.slug,shot:s.id,format:r.formato,style:r.avatar_estilo,version,layers,narration:complex&&!s.camadas?.react?.presente&&falaDe(r,s,version)?[{speech:numerosPorExtenso(falaDe(r,s,version)),sourceWindow:s.janela,voice:r.copy.versoes.find(v=>v.id===version)?.direcao_voz,mode:'post-production'}]:[]};
}
