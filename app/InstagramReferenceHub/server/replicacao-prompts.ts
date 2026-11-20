import {numerosPorExtenso} from './numeros-fala';
// Contrato de produção da OP 001: fala literal, referência visual por take e templates por formato/engine.
import {fabricatePrompts} from "./prompt-factory";
import type { AnguloVideo } from "./analise";
import { FORMATOS, type Formato } from "./replication-formats";
export { FORMATOS, type Formato } from "./replication-formats";
export type Genero = "homem" | "mulher";
export type StillV2 = {
  id:string; take:string; frame:string; quem:string|null; extras?:string; boca?:"fechada"|"livre";
  olhar?:boolean; opcional?:boolean; uso?:string; prompt_override?:string;
  sourceWindow?:[number,number];sourceWindows?:[number,number][];
  estado?:string; frame_sha256?:string; angulo?:AnguloVideo;
};
export type ShotV2 = {
  id:string; janela:[number,number]; still:string; tipo:"falado"|"falado + interação"|"mudo"|"inserto";
  fala:string; acao:string; evento?:string; morfose?:string|null; olhar?:boolean; gerar_s?:number;
  notas?:string; takes_extras?:string[]; prompt_override?:string;
  referencia_take?:string; estado_inicial?:string; estado_final?:string; angulo?:AnguloVideo;
  composicaoSegmentos?: {ini:number;fim:number;fala:string;camadas:NonNullable<ShotV2["camadas"]>}[];
  camadas?: {fundo?:{acao:string;estilo:string;presente:boolean};react?:{acao:string;enquadramento:string;presente:boolean}};
  react_acao?:string; acao_geracao?:string; still_final?:string; direcao_camera?:string;
};
/** `medicoes`: duração falada medida da fala ADAPTADA (fala igual à fonte usa os timestamps da transcrição). */
export type VersaoCopy = {id:string; nome:string; falas:Record<string,string>; direcao_voz?:string; legendas?:Record<string,string>; medicoes?:Record<string,{segundos:number;fonte:string}>};
export type ReplicacaoV2 = {
  versao:2|3; ref:string; expert:string; slug:string; formato:Formato; engine:string;
  idioma_fala:string; genero:Genero; avatar:string; avatar_estilo:"3d"|"real";
  analise_sha256?:string; copy:{ativa:string; versoes:VersaoCopy[]};
  stills:StillV2[]; shots:ShotV2[]; pos?:string[]; decisoes?:string[];
  /** TROCA DE PRODUTO (alteração pontual): o que muda na cena. A imagem de `avatar` mostra o que entra. */
  troca?:Alteracao;
};
/** Alteração pontual (Lukas, 10/11/2026). tipo ausente = "objeto" (troca de produto, formato original de 09/11).
 * objeto: original → novo, texto legível · adicionar: novo + onde · roupa: quem + novo (original opcional)
 * avatar: quem + novo (a pessoa da imagem) · cenario: original (parte do cenário) → novo. */
export type Alteracao={tipo?:"objeto"|"adicionar"|"roupa"|"avatar"|"cenario"; original?:string; novo:string; texto?:string; onde?:string; quem?:string};
export const isTroca=(r:Pick<ReplicacaoV2,"formato">)=>r.formato==="TROCA DE PRODUTO";
const EXIGE:Record<string,(keyof Alteracao)[]>={objeto:["original","novo"],adicionar:["novo","onde"],roupa:["quem","novo"],avatar:["quem","novo"],cenario:["original","novo"]};
export function validarAlteracao(a?:Partial<Alteracao>|null){
  const tipo=a?.tipo??"objeto";if(!EXIGE[tipo])throw new Error('Alteração com tipo desconhecido: '+tipo);
  const falta=EXIGE[tipo].filter(k=>!String(a?.[k]??"").trim());
  if(falta.length)throw new Error(`Alteração "${tipo}" sem ${falta.join(", ")} no producao.json do expert ("alteracao")`);
  return {...a,tipo} as Alteracao&{tipo:NonNullable<Alteracao["tipo"]>};
}
function trocaDe(r:ReplicacaoV2){return validarAlteracao(r.troca);}
const maiuscula=(s?:string)=>(s??"").replace(/^./,c=>c.toUpperCase());
export type Problema = {nivel:"erro"|"aviso"; codigo:string; mensagem:string};
const base=(p:string)=>p.split(/[\\/]/).pop()!;
const frase=(s?:string|null)=>s?s.trim().replace(/([^.!?…])$/,"$1."):"";
const junta=(...xs:(string|undefined)[])=>xs.filter(Boolean).join(" ");
const palavras=(s:string)=>s.split(/\s+/).filter(Boolean).length;
const normal=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const isReact=(r:ReplicacaoV2)=>r.formato==="REACT"||r.formato==="REACT + ANIMAÇÃO";
const seed=(r:ReplicacaoV2)=>/seedance/i.test(r.engine);
export const engineValida=(s:string)=>/^(Veo 3(?:\.1)?(?: Lite)?|Omni(?:\/Flow)?|Flow|Seedance 2(?:\.0)?)$/i.test(s);
// Envelope editorial: 24 palavras ajudam a segmentar, mas nao sao um teto do Veo.
// Veo 3.1 permite ate 8s; 25 palavras em 6-8s podem manter a cadencia agil aprovada.
export const limiteFala=(engine:string)=>/omni|flow/i.test(engine)?{s:10,palavras:30}:/seedance/i.test(engine)?{s:15,palavras:60}:{s:8,palavras:30};
export const anguloTexto=(a?:AnguloVideo)=>a?`${a.plano}; ${a.altura}; ${a.orientacao}; ${a.movimento}`:"ângulo ainda não conferido";
// A referência descreve o movimento em tempo do vídeo-fonte; o modelo recebe um clipe de N segundos.
// Converter para offset do clipe e descartar corte que cai no fim da janela (não acontece dentro dele).
export const ajustarTempos=(texto:string,janela:[number,number])=>{
  const dur=janela[1]-janela[0], num=(s:string)=>Number(s.replace(",","."));
  const fmt=(x:number)=>x.toFixed(1).replace(".",",");
  const out=texto.replace(/(?:(\d+[.,]?\d*)\s*(?:-|–|a)\s*(\d+[.,]?\d*)|(\d+[.,]?\d*))\s*s\b/g,(_m,q1,q2,q3)=>{
    if(q1&&q2){
      const ini=num(q1)-janela[0], fim=num(q2)-janela[0];
      if(ini>=dur-0.3) return "";
      return `${fmt(Math.max(0,ini))}–${fmt(Math.min(dur,fim))} s do clipe`;
    }
    const t=num(q3)-janela[0];
    if(t>=dur-0.3||t<0) return "";
    return `${fmt(t)} s do clipe`;
  });
  return out.replace(/\s{2,}/g," ").replace(/\s+([,.;])/g,"$1").trim();
};
function versaoDe(r:ReplicacaoV2,id=r.copy.ativa) {
  const v=r.copy.versoes.find(v=>v.id===id); if(!v) throw new Error(`Versão de copy inexistente: ${id}`); return v;
}
// Ação do react vem da análise com jargão (lip-sync, quadros f2/f22–f23, "plate"); o gerador recebe só a ação visível.
export function acaoReactGeracao(a?:string) {
  if(!a)return a;
  return a.replace(/\s*,?\s*\b(com\s+)?(lip.?sync|sincronia labial)\b/gi,"")
    .replace(/\s*\(?\bf\d+(\s*[–-]\s*f\d+)?\)?/gi,"")
    .replace(/[;,]?\s*sem contato com o plate/gi,"")
    .replace(/^avatar fixo/i,"permanece parada")
    .replace(/\s+([,;.])/g,"$1").replace(/([,;])(?=[,;])/g,"").replace(/^[,;\s]+|[,;\s]+$/g,"").trim();
}
export function falaDe(r:ReplicacaoV2,s:ShotV2,v=r.copy.ativa) {return versaoDe(r,v).falas[s.id]??s.fala??"";}
export function legendaDe(r:ReplicacaoV2,s:ShotV2,v=r.copy.ativa) {return versaoDe(r,v).legendas?.[s.id]??falaDe(r,s,v);}
export const nomeStill=(r:ReplicacaoV2,id:string)=>`${id}_${r.ref}_${r.slug.split("-")[0].toUpperCase()}.png`;
export const nomeShot=(r:ReplicacaoV2,id:string,v=r.copy.ativa)=>`${id}_${r.ref}_${r.slug.split("-")[0].toUpperCase()}${v!=="V1"?`_${v}`:""}.v1.mp4`;
export function anexosStill(r:ReplicacaoV2,s:StillV2) {
  // Troca de produto: o quadro original governa tudo; a segunda referência é só o produto novo (ocupa o papel de identidade).
  if(isTroca(r)) return [{slot:`@${base(s.frame)}`,arquivo:s.frame,papel:"frame de referência"},{slot:`@${r.avatar}`,arquivo:r.avatar,papel:"contact sheet do avatar"}];
  if(r.slug!=="bruno-goytacazes" && (r.formato==="RECEITA POV" || !s.quem && !isReact(r))) return [{slot:seed(r)?"@image1":`@${base(s.frame)}`,arquivo:s.frame,papel:"frame de referência"}];
  return seed(r)?[
    {slot:"@image1",arquivo:r.avatar,papel:"contact sheet do avatar"},
    {slot:"@image2",arquivo:s.frame,papel:"frame de referência"},
  ]:[{slot:`@${base(s.frame)}`,arquivo:s.frame,papel:"frame de referência"},{slot:`@${r.avatar}`,arquivo:r.avatar,papel:"contact sheet do avatar"}];
}
function stillPromptBase(r:ReplicacaoV2,s:StillV2):string {
  // Overrides legados não são executáveis. A migração deve voltar aos dados conferidos.
  const av=seed(r)?"@image1":`@${r.avatar}`;
  const f=anexosStill(r,s).find(x=>x.papel==="frame de referência")!.slot;
  const boca=s.boca==="livre"&&!isReact(r)?"":`Boca fechada e neutra${s.olhar===false?"":", olhando para a lente"}.`;
  const limpa="Remova os textos sobrepostos à imagem; mantenha os rótulos e marcas dos objetos como no frame.";
  const fim=seed(r)?"":`Nomeie a imagem gerada com o nome → ${nomeStill(r,s.id)}.`;
  if(isTroca(r)){
    const t=trocaDe(r);
    const resto=(exceto:string)=>`Todo o resto fica igual a ${f}: ${exceto} Não acrescente, remova nem mova mais nada.`;
    const textos="Remova somente textos sobrepostos de edição, se houver; mantenha os demais rótulos dos objetos como no frame.";
    if(t.tipo==="objeto")return junta(
      `TROCA DE PRODUTO: edite ${f} trocando um único objeto: ${t.original} vira ${t.novo}, idêntico ao produto de ${av}.`,
      `O produto novo ocupa exatamente o lugar do antigo: mesma posição, tamanho, ângulo, perspectiva, foco e sombra; mãos, copos, braços e bordas do quadro que cobrem o produto antigo continuam cobrindo o novo.`,
      t.texto?`Copie a frente da embalagem de ${av} com fidelidade: texto "${t.texto}" nítido e legível, mesmas cores, desenho e proporção. Nas faces laterais visíveis, continue as cores e o desenho da embalagem sem inventar textos.`:`Copie ${av} com fidelidade: mesmas cores, desenho e proporção, sem inventar textos.`,
      `Nenhum vestígio de ${t.original}: sem a marca, as cores ou o texto antigos em nenhum ponto da imagem.`,
      resto("as mesmas pessoas, rostos, cabelos, roupas, poses, mãos, cenário, objetos, luz, cor, profundidade de campo, enquadramento e câmera."),
      frase(s.extras),textos,fim);
    const cabeca={
      adicionar:`ALTERAÇÃO PONTUAL: edite ${f} acrescentando um único objeto: ${t.novo}, idêntico ao de ${av}, ${t.onde}. Escala, perspectiva, luz, sombra e foco coerentes com a cena; mãos e objetos que estão na frente desse lugar continuam na frente.${t.texto?` Texto "${t.texto}" nítido e legível.`:""}`,
      roupa:`ALTERAÇÃO PONTUAL: edite ${f} trocando só a roupa desta pessoa: ${t.quem}.${t.original?` Sai: ${t.original}.`:""} Entra: ${t.novo}, como em ${av}. Mesmo rosto, cabelo, corpo, pose e mãos; caimento, dobras, luz e sombra da roupa nova coerentes com a pose. Nenhum pedaço da roupa antiga aparece.`,
      avatar:`ALTERAÇÃO PONTUAL: edite ${f} trocando só ${t.quem} pela pessoa de ${av} (${t.novo}): rosto, cabelo, tom de pele e traços de ${av}; mesma pose, gesto, expressão, direção do olhar, posição, escala e roupa que ${t.quem} tem em ${f}.`,
      cenario:`ALTERAÇÃO PONTUAL: edite ${f} mudando só o cenário. Sai: ${t.original}. Entra: ${t.novo}, como em ${av}. A luz do cenário novo combina com a luz que já está nas pessoas; perspectiva e profundidade de campo iguais.`,
    }[t.tipo];
    const exceto={
      adicionar:"as mesmas pessoas, rostos, roupas, poses, mãos, cenário, objetos, luz, cor, enquadramento e câmera.",
      roupa:"as mesmas pessoas, rostos, cabelos, poses, mãos, as roupas das outras pessoas, cenário, objetos, luz, cor, enquadramento e câmera.",
      avatar:"as outras pessoas, as roupas, cenário, objetos, luz, cor, profundidade de campo, enquadramento e câmera.",
      cenario:"as mesmas pessoas, rostos, cabelos, roupas, poses, mãos, os objetos em primeiro plano, enquadramento e câmera.",
    }[t.tipo];
    return junta(cabeca,resto(exceto),frase(s.extras),textos,fim);
  }
  if(isReact(r)) return junta(`Use ${av} como identidade e ${f} somente como contexto da reação para criar somente o plate do avatar, de frente, em fundo simples e uniforme, enquadrado do peito para cima.`,boca,frase(s.extras),limpa,fim);
  if(r.formato==="RECEITA POV") return junta(`Recrie o preparo de ${f}, mantendo somente alimentos, utensílios e mãos já visíveis, com a mesma composição e perspectiva.`,frase(s.extras),limpa,fim);
  if(r.formato==="REAL→3D MESMO ÂNGULO") {
    const troca=s.quem?` Substitua ${s.quem} pelo personagem de ${av}.`:"";
    return junta(`Recrie todo o quadro de ${f} em animação 3D estilo Pixar, incluindo cenário e objetos.${troca} Preserve exatamente o ângulo original, enquadramento, posição e escala: ${anguloTexto(s.angulo)}.`,frase(s.extras),boca,limpa,fim);
  }
  if(!s.quem) return junta(`Recrie a imagem ${f} exatamente como está.`,frase(s.extras),limpa,fim);
  const cena=r.avatar_estilo==="3d"
    ?`Recrie a imagem ${f} substituindo ${s.quem} pelo personagem 3D de ${av}, mantendo seu estilo integrado ao quadro.`
    :`Recreate ${f} but replace the person with the person from ${av}, matching the lighting, shadows, color grade, depth of field and overall camera look of ${f}.\n\nThe face, hair and body proportions reference is from the person in ${av}. Do not recreate the person of ${f}.\n\nKeep the same clothes, pose, hands, objects and setting of ${f}. High-resolution, sharp focus.`;
  // Base REC-01 do acervo de prompts; a descrição automática da pessoa original não entra na foto realista.
  if(r.avatar_estilo!=="3d")return junta(cena,frase(s.extras),s.boca==="livre"?"":`Closed mouth${s.olhar===false?"":", looking at the lens"}.`,"Remove the overlaid captions; keep labels and brands on objects as in the frame.");
  return junta(cena,frase(s.extras),boca,limpa,fim);
}
export function stillPrompt(r:ReplicacaoV2,s:StillV2):string {
  const prompt=stillPromptBase(r,s);
  if(r.slug!=="bruno-goytacazes") return prompt;
  const av=seed(r)?"@image1":`@${r.avatar}`;
  return junta(
    `IDENTIDADE E FIGURINO FIXOS: ${av} é a fonte exclusiva da aparência e de TODA a roupa do Bruno. Substitua a personagem inteira, incluindo corpo e figurino, pelo mesmo personagem masculino adulto do contact sheet: mesmo rosto, cabelo, barba, óculos amarelos em formato de estrela e proporções.`,
    prompt,
    `Preserve exatamente o figurino do contact sheet em todas as partes visíveis: jaqueta varsity azul-marinho com seus patches e punhos brancos, camiseta branca e calça COMPRIDA AMARELA, com duas pernas separadas. Não copie nem misture roupas da chef original: sem saia, vestido, avental, dólmã verde, túnica ou faixa de cabelo. O frame orienta apenas cenário, composição, pose, ação, alimentos, utensílios, contatos das mãos, luz, ângulo e enquadramento; ele não define a identidade nem a roupa. Em detalhes de mãos, preserve somente as mãos e mangas que já aparecem, com a roupa do Bruno. Mantenha o recorte original; não acrescente rosto, corpo ou pernas fora do quadro.`
  );
}
// Fronteira de fala que pode abrir uma geração nova: fim de frase, silêncio de verdade
// (shot mudo entre as duas) ou corte de câmera. Vírgula e pausa curta NÃO são fronteira:
// partir ali picota a locução em duas gerações e o take sai cortado na edição.
const fimDeOracao=(f:string)=>/[.!?…]["”')]?$/.test(f.trim());
export function divisaoIndevida(
  antes:{fala:string;ini:number;fim:number},
  depois:{fala:string;ini:number;fim:number},
  cortes:number[],
  limite:{s:number;palavras:number},
):{palavras:number;segundos:number}|null {
  const a=antes.fala.trim(),d=depois.fala.trim();
  if(!a||!d)return null;                       // shot mudo/inserto tem fronteira própria
  if(fimDeOracao(a))return null;               // terminou a frase: geração pode fechar
  if(cortes.some(c=>c>=antes.fim-0.15&&c<=depois.ini+0.15))return null; // corte de câmera
  if(depois.ini-antes.fim>=1)return null;      // silêncio separa de fato
  const n=palavras(a)+palavras(d),seg=depois.fim-antes.ini;
  if(seg>limite.s+0.01)return null; // palavras são pista editorial; o limite físico é o tempo.
  return{palavras:n,segundos:seg};
}
export const AUDIO_FALA_SEM_MUSICA="Áudio de gravação direta: voz seca, limpa, isolada e audível desde a primeira sílaba até o fim da frase, sem música.";
export function exigirContextoVocal(r:ReplicacaoV2,v=r.copy.ativa) {
  const precisa=r.formato!=="RECEITA POV"&&r.shots.some(s=>(s.tipo!=="inserto"||isReact(r))&&falaDe(r,s,v));
  if(precisa&&r.slug!=="bruno-goytacazes"&&!versaoDe(r,v).direcao_voz?.trim())
    throw Error('Direção vocal da personagem pendente: resolver pelo contexto e registrar direcao_voz antes de exportar.');
}
/** Analysis frame IDs are provenance, not commands for a video generator. Preserve the visible verbs. */
export function acaoParaGeracao(text:string){
 return text.replace(/\(?\b(?:em|entre)\s+f\d+(?:\s*[–−→-]\s*f?\d+|\s+e\s+f\d+)?\)?/gi,'')
  .replace(/\(?\bf\d+(?:\s*[–−→-]\s*f?\d+)?\)?/gi,'')
  .replace(/morfose explícita:\s*/gi,'').replace(/\(\s*\)/g,'')
  .replace(/\s+([,;.])/g,'$1').replace(/\s{2,}/g,' ').trim();
}
export function videoPrompt(r:ReplicacaoV2,s:ShotV2,v=r.copy.ativa):string {
  const ele=r.genero==="homem"?"ele":"ela", E=r.genero==="homem"?"Ele":"Ela";
  const a=s.acao_geracao??(isReact(r)?(s.react_acao??"reage com uma leve mudança de expressão enquanto fala"):s.acao);
  const inserto=!isReact(r)&&s.tipo==="inserto";
  const cam=s.direcao_camera?"":isReact(r)?"Enquadramento frontal fixo, apenas o plate do avatar.":`Mantenha o ângulo original e o movimento de câmera da referência: ${ajustarTempos(anguloTexto(s.angulo),s.janela)}.`;
  const slots=seed(r)?(r.formato==="RECEITA POV"||s.tipo==="inserto"&&!isReact(r)?"@image1 é o primeiro quadro do shot.":`@image1 é a identidade; @image2 é o primeiro quadro${s.still_final?"; @image3 é o último quadro":""} do shot contínuo.`):"";
  const fala=numerosPorExtenso(falaDe(r,s,v));
  const evento=acaoParaGeracao(s.evento??""),acao=acaoParaGeracao(a);
  const complemento=!isReact(r)&&evento&&!normal(acao).includes(normal(evento))?frase(evento):"";
  // Camera continuity is directed per shot; never impose a universal no-cut command.
  const abertura=junta(slots,frase(s.direcao_camera));
  if(isTroca(r)){
    const t=trocaDe(r),quem=r.stills.find(x=>x.id===s.still)?.quem?.trim();
    // Na análise "legenda" pode ser texto dentro da cena (ex.: foto no celular); no gerador vira "texto na imagem".
    const acao=acaoParaGeracao(a).replace(/\blegendas?\b/gi,"texto na imagem"),complemento=!evento||normal(acao).includes(normal(evento))?"":frase(evento.replace(/\blegendas?\b/gi,"texto na imagem"));
    const fixo={
      objeto:`${maiuscula(t.novo)} permanece igual à imagem inicial durante todo o clipe: mesma forma${t.texto?` e rótulo "${t.texto}" legível`:""}, sem virar outra embalagem nem outra marca.`,
      adicionar:`${maiuscula(t.novo)} continua no mesmo lugar e com a mesma forma durante todo o clipe${t.texto?`, com o texto "${t.texto}" legível`:""}.`,
      roupa:`A roupa nova (${t.novo}) permanece igual à imagem inicial do começo ao fim, sem voltar à roupa antiga.`,
      avatar:`${maiuscula(t.quem!)} é a pessoa da imagem inicial e mantém esse rosto do começo ao fim, sem voltar a outra pessoa.`,
      cenario:`O cenário da imagem inicial permanece igual durante todo o clipe, sem voltar ao cenário antigo.`,
    }[t.tipo];
    const cena=`As mesmas pessoas, roupas, cenário e luz da imagem inicial, sem trocar ninguém. Cada pessoa mantém do começo ao fim do clipe o mesmo rosto, a mesma idade, o mesmo cabelo e penteado e a mesma roupa da imagem inicial; os objetos que ela segura continuam os mesmos. ${fixo}`;
    if(inserto||!fala)return junta(abertura,cena,frase(acao),complemento,cam,fala?"Sem fala gerada; a voz entra na edição. Sem música; apenas o som ambiente natural.":"Sem falas nem música; apenas o som ambiente natural da ação.");
    const direcao=versaoDe(r,v).direcao_voz?.trim();
    // Diálogo com falante marcado na copy: "[a filha, que segura a câmera] ... [a mãe loira] ...".
    const turnos=[...fala.matchAll(/\[([^\]]+)\]\s*([^\[]+)/g)].map(m=>({quem:m[1].trim(),texto:m[2].trim()}));
    const dito=turnos.length?`Diálogo em ${r.idioma_fala}, nesta ordem: `+turnos.map(t=>`${t.quem} diz: "${t.texto}"`).join(" Em seguida, ")+".":`${quem?`Quem fala é ${quem}`:"Quem fala é a pessoa em quadro"}, em ${r.idioma_fala}, e diz: "${fala}"`;
    return junta(abertura,cena,frase(direcao),AUDIO_FALA_SEM_MUSICA,dito,frase(acao),complemento,s.olhar===false?"":"Olhos na lente.",cam);
  }
  if(r.formato==="RECEITA POV" || inserto) return junta(abertura,frase(acao),complemento,cam,"Sem falas nem música; apenas o som ambiente natural da ação.");
  if(s.tipo==="mudo"&&!fala) return junta(abertura,`${E} permanece de boca fechada.`,frase(`${E} ${acao}`),complemento,cam,"Sem música; apenas o som ambiente natural.");
  // Faixa etária e interpretação pertencem à versão/personagem; gênero não significa voz adulta.
  const direcaoVoz=versaoDe(r,v).direcao_voz?.trim() || (r.slug==="bruno-goytacazes"
    ?"Voz masculina adulta de registro médio-grave, projetada, com empolgação e ritmo agitado e acelerado, preservando dicção e palavras completas."
    :"");
  const dito=`${r.genero==="homem"?"O personagem":"A personagem"} fala em ${r.idioma_fala}, ${ele} diz: "${fala}"`;
  return junta(abertura,frase(direcaoVoz),AUDIO_FALA_SEM_MUSICA,dito,frase(`${E} ${acao}`),complemento,s.olhar===false?"":"Olhos na lente.",cam);
}
export function duracaoGerar(s:ShotV2,fala=s.fala,r?:ReplicacaoV2) {
  if(s.gerar_s)return s.gerar_s;
  const need=Math.max(s.janela[1]-s.janela[0],palavras(fala)/3.2);
  return r&&seed(r)?Math.ceil(need):need<=2?2:need<=4?4:need<=6?6:need<=8?8:/omni|flow/i.test(r?.engine??"")?10:8;
}
export function ordem(r:ReplicacaoV2) {
  const vistos=new Set<string>();const out:{item:string;tipo:"still"|"shot";shot:string}[]=[];
  for(const s of r.shots){for(const id of [s.still,s.still_final].filter(Boolean) as string[])if(!vistos.has(id)){vistos.add(id);out.push({item:id,tipo:"still",shot:s.id});}out.push({item:s.id,tipo:"shot",shot:s.id});}return out;
}
export function passos(r:ReplicacaoV2,s:ShotV2,v=r.copy.ativa):string[] {
  const st=r.stills.find(x=>x.id===s.still),primeiro=ordem(r).find(o=>o.item===s.still)?.shot===s.id;
  const out:string[]=[];
  if(st&&primeiro)out.push(`Imagem: anexe ${anexosStill(r,st).map(x=>`${x.slot} = ${x.arquivo}`).join("; ")}. Cole o prompt de ${st.id} e salve como ${nomeStill(r,st.id)}. Confira mãos, contatos, props, estado inicial e perspectiva contra ${st.take}.`);
  else if(st)out.push(`Imagem: reaproveite ${st.id}, cujo estado inicial é o mesmo deste shot.`);
  out.push(`Vídeo: ${r.engine}; ${seed(r)?(r.formato==="RECEITA POV"||s.tipo==="inserto"&&!isReact(r)?`@image1 = ${s.still}`:`@image1 = ${r.avatar}; @image2 = ${s.still}${s.still_final?`; @image3 = ${s.still_final}`:""}`):`uma imagem inicial = ${s.still}`}; duração ${duracaoGerar(s,falaDe(r,s,v),r)}s.`);
  if(r.formato==="RECEITA POV" || s.tipo==="inserto"&&!isReact(r)&&falaDe(r,s,v))out.push(`Narração na edição (literal): "${numerosPorExtenso(falaDe(r,s,v))}".`);
  out.push(`Legenda na edição (${v}, literal): "${legendaDe(r,s,v)}".`);
  if(s.morfose)out.push(`Morfose: ${s.morfose}. ${seed(r)?"Anexe os estados inicial/final se a rota for first+last frame.":"Conferir a trajetória e os estados no modo Frames/Elements escolhido; usar frame final apenas quando o modo suportar e o plano exigir."}`);
  out.push(`Confira a ação, a fala completa e a câmera contra a referência; salve como ${nomeShot(r,s.id,v)}.`);
  return out;
}
export function problemas(r:ReplicacaoV2,seg:any):Problema[] {
  const out:Problema[]=[];const add=(nivel:"erro"|"aviso",codigo:string,mensagem:string)=>out.push({nivel,codigo,mensagem});
  if(!FORMATOS.includes(r.formato))add("erro","FORMATO","Formato sem playbook");
  if(!engineValida(r.engine))add("erro","ENGINE","Engine sem template: escolha Omni/Flow (Veo 3) ou Seedance 2.0");
  if(!seg?.analise_sha256||r.analise_sha256!==seg.analise_sha256)add("erro","ANALISE","Falta análise dupla conferida, ou os prompts usam uma revisão anterior");
  if(!r.copy.versoes.some(v=>v.id===r.copy.ativa))add("erro","COPY","Versão ativa inexistente");
  if(new Set(r.copy.versoes.map(v=>v.id)).size!==r.copy.versoes.length)add("erro","COPY","IDs de copy repetidos");
  const takes=new Map<string,any>();for(const s of seg?.shots??[])for(const t of s.takes??[])takes.set(t.id,{...t,shot:s.id});
  const usados=new Set(r.shots.flatMap(s=>[s.still,s.still_final].filter(Boolean)));
  for(const st of r.stills){
    const t=takes.get(st.take);
    if(st.prompt_override)add("erro","OVERRIDE",`${st.id}: remova o prompt_override legado`);
    if(!t)add("erro","TAKE",`${st.id}: ${st.take} inexistente`);
    else {if(t.frame!==st.frame||t.frame_sha256!==st.frame_sha256)add("erro","FRAME",`${st.id}: frame anexado diverge de ${st.take}`);if(st.estado!==t.estado)add("erro","ESTADO",`${st.id}: estado do still diverge do take`);}
    if(!usados.has(st.id)&&!st.opcional)add("erro","STILL_SEM_USO",`${st.id}: ainda sem uso; marcar como referência opcional`);
    if(r.formato==="REAL→3D MESMO ÂNGULO"&&(!st.angulo||!stillPrompt(r,st).includes(anguloTexto(st.angulo))))add("erro","ANGULO",`${st.id}: formato real→3D exige ângulo original conferido`);
  }
  const acoes=new Map<string,string>();let fim=0;
  for(const s of r.shots){
    if(r.formato==="REACT + ANIMAÇÃO"&&(!s.camadas?.fundo||!s.camadas?.react))add("erro","CAMADAS",`${s.id}: analisar ações e presença de fundo e react separadamente`);
    if(s.prompt_override)add("erro","OVERRIDE",`${s.id}: remova o prompt_override legado`);
    if(isReact(r)&&!s.react_acao)add("erro","REACT_ACAO",`${s.id}: descreva a reação própria do plate em react_acao`);
    const key=normal(r.formato==="REACT"?(s.react_acao??""):s.acao);if(acoes.has(key))add("erro","ACAO_REPETIDA",`${acoes.get(key)} e ${s.id}: mesma ação`);else acoes.set(key,s.id);
    if(!key||/TODO/.test(s.acao))add("erro","ACAO",`${s.id}: ação ainda não conferida`);
    const ss=seg?.shots?.find((x:any)=>x.id===s.id), st=r.stills.find(x=>x.id===s.still),t=ss?.takes?.[0];
    if(!ss||Math.abs(s.janela[0]-ss.ini)>.03||Math.abs(s.janela[1]-ss.fim)>.03||Math.abs(s.janela[0]-fim)>.03)add("erro","JANELA",`${s.id}: janela diverge da análise/cronologia`);
    fim=s.janela[1];
    if(!st)add("erro","STILL",`${s.id}: still inexistente`);
    if(t&&(s.referencia_take!==t.id||s.estado_inicial!==t.estado))add("erro","REFERENCIA",`${s.id}: take/estado inicial não corresponde à referência`);
    if(st&&t&&st.estado!==t.estado)add("erro","STILL_ESTADO",`${s.id}: still compartilhado com um estado visual diferente`);
    if(r.formato==="REAL→3D MESMO ÂNGULO"&&(!s.angulo||JSON.stringify(s.angulo)!==JSON.stringify(t?.angulo)))add("erro","ANGULO",`${s.id}: ângulo original não fixado`);
    if(s.morfose&&!/edi[cç][aã]o|first.?\+?.?last/i.test(s.morfose))add("erro","MORFOSE",`${s.id}: declare rota de morfose`);
    if(s.morfose&&!/edi[cç][aã]o/i.test(s.morfose)&&(!seed(r)||!s.still_final||!r.stills.some(st=>st.id===s.still_final)))add("erro","MORFOSE",`${s.id}: first+last exige engine e still final compatíveis`);
    if(s.morfose&&/edi[cç][aã]o/i.test(s.morfose)&&!s.acao_geracao)add("erro","MORFOSE",`${s.id}: declare ação de geração antes da transformação feita na edição`);
    for(const v of r.copy.versoes){
      const f=falaDe(r,s,v.id),p=videoPrompt(r,s,v.id);
      if(s.tipo.startsWith("falado")&&r.formato!=="RECEITA POV"&&!f)add("erro","FALA",`${s.id} ${v.id}: falta fala`);
      // Fala contínua partida em duas gerações: dentro do mesmo setup é erro (o take sai
      // picotado); entre setups diferentes é aviso para conferir se a fonte corta a câmera ali.
      const prevShot=r.shots[r.shots.indexOf(s)-1];
      if(prevShot){
        const limite=limiteFala(r.engine);
        const div=divisaoIndevida({fala:falaDe(r,prevShot,v.id),ini:prevShot.janela[0],fim:prevShot.janela[1]},{fala:f,ini:s.janela[0],fim:s.janela[1]},(seg?.cortes??[])as number[],limite);
        if(div){
          const setupAntes=seg?.shots?.find((x:any)=>x.id===prevShot.id)?.takes?.at(-1)?.setup;
          const mesmoSetup=!!setupAntes&&setupAntes===t?.setup;
          const base=`${prevShot.id}+${s.id} ${v.id}: fala contínua dividida em duas gerações — junto são ${div.palavras} palavras em ${div.segundos.toFixed(2)}s, dentro do preset ${limite.s}s`;
          add(mesmoSetup?"erro":"aviso","FALA_PARTIDA",mesmoSetup?`${base}; mesmo setup ${setupAntes}, sem corte de câmera`:`${base}; setups ${setupAntes}→${t?.setup}, conferir se a fonte corta a câmera ali`);
        }
      }
      if(/\d/.test(f))add("aviso","NUMERO",`${s.id} ${v.id}: escreva números por extenso na fala; preserve a legenda se necessário`);
      const omni=/omni|flow/i.test(r.engine),lim=limiteFala(r.engine);
      if(!seed(r)&&palavras(f)>lim.palavras)add("aviso","FALA_LONGA",`${s.id} ${v.id}: ${palavras(f)} palavras; medir a fala e conferir dicção, sem cortar por quantidade fixa.`);
      if(!seed(r)&&!(omni?[2,4,6,8,10]:[2,4,6,8]).includes(duracaoGerar(s,f,r)))add("erro","DURACAO",`${s.id}: duração incompatível com o contrato ${omni?"Omni":"Veo"}`);
      if(/lip.?sync|sincronia labial|legenda|subtitle|caption/i.test(f?p.replace(numerosPorExtenso(f),""):p))add("erro","VOCABULARIO",`${s.id}: instrução técnica indevida no prompt de vídeo`);
      const visual=normal(s.acao+" "+s.evento+" "+JSON.stringify(ss?.takes?.map((t:any)=>t.estado_visual)??[]));
      for(const [falaAcao,visualAcao] of [[/\b(bata|bater)\s+(tudo|a mistura|os ingredientes|bem)/i,/bat|mistur|liquidific/],[/\b(despeje|despejar)\b/i,/despej|vert|fluxo/],[/\b(corte|cortar|pique|picar)\b/i,/cort|pic|part|separ/]] as [RegExp,RegExp][]){
        if(falaAcao.test(f)&&!visualAcao.test(visual))add("aviso","ACAO_VISUAL",`${s.id} ${v.id}: fala descreve ação sem correspondência nos takes; conferir sincronização`);
      }
      const props=normal(ss?.takes?.flatMap((t:any)=>t.estado_visual?.props??[]).join(" ")??"");
      for(const termo of ["pão","ovos","maçã","chocolate","copo","leite","liquidificador","air fryer","travessa","colher","iogurte","banana"]){
        if(normal(f).includes(normal(termo))&&!props.includes(normal(termo)))add("aviso","OBJETO",`${s.id} ${v.id}: fala cita ${termo}, ausente dos takes/estados; conferir sincronização`);
      }
    }
  }
  for(const v of r.copy.versoes)for(const id of Object.keys(v.falas))if(!r.shots.some(s=>s.id===id))add("erro","COPY_ORFA",`${v.id}: fala aponta para shot inexistente ${id}`);
  return out;
}
export const lint=(r:ReplicacaoV2,seg:any)=>problemas(r,seg).map(p=>`${p.nivel==="erro"?"ERRO":"AVISO"} [${p.codigo}] ${p.mensagem}`);
export function tabelaEvidencia(r:ReplicacaoV2,seg:any,v=r.copy.ativa) {
  const esc=(x:string)=>x.replace(/\|/g,"\\|").replace(/\n/g," ");
  return ["| SHOT | Janela | Fala | TAKE(s) | STILL | Ação | Evento |","|---|---|---|---|---|---|---|",...r.shots.map(s=>`| ${s.id} | ${s.janela.map(n=>n.toFixed(2)).join("–")}s | ${esc(falaDe(r,s,v))} | ${(seg?.shots?.find((x:any)=>x.id===s.id)?.takes??[]).map((t:any)=>t.id).join(", ")} | ${s.still} | ${esc(s.acao)} | ${esc(s.evento||"nenhum")} |`)].join("\n");
}
export function markdown(r:ReplicacaoV2,seg:any,v=r.copy.ativa) {
  if(r.formato==='REACT + ANIMAÇÃO'){
    const lines=[`# ${r.ref} → ${r.expert}`,`Formato: ${r.formato}. Gerações de fundo e react separadas; composição na edição.`,''];
    for(const s of r.shots){const bundle=fabricatePrompts(r,s,v);lines.push(`## Trecho ${s.id} · ${s.janela.join('–')}s`);
      for(const layer of bundle.layers)lines.push(`### ${layer.layer}${layer.segment?' · segmento '+layer.segment:''}`,`Anexos: ${layer.attachments.map(a=>`${a.role}: ${a.file}`).join('; ')}`,'ChatGPT:','```',layer.chatgpt,'```','Nano Banana:','```',layer.nanobanana,'```','Veo:','```',layer.video,'```','');
      for(const track of bundle.narration)lines.push('Narração separada na edição: '+track.speech);
    }return lines.join('\n');
  }
  const ver=versaoDe(r,v);const issues=lint(r,seg);
  const L=[`# ${r.ref} → ${r.expert} · ${ver.id} ${ver.nome}`,"",`Formato ${r.formato} · ${r.engine} · avatar \`${r.avatar}\`.`,"",`Análise: \`${r.analise_sha256??"PENDENTE"}\`. ${issues.some(x=>x.startsWith("ERRO"))?"BLOQUEADA para geração.":"Dados conferidos; geração ainda não realizada."}`,"",tabelaEvidencia(r,seg,v),"","## Stills",""];
  for(const s of r.stills)L.push(`### ${s.id}${s.opcional?" (referência opcional)":""} · ${s.take}`,`Anexar: ${anexosStill(r,s).map(x=>`${x.slot} = ${x.arquivo}`).join("; ")}`,"```",stillPrompt(r,s),"```","");
  L.push("## Vídeos","");for(const s of r.shots){L.push(`### ${s.id} · ${duracaoGerar(s,falaDe(r,s,v),r)}s · imagem inicial ${s.still}`,"```",videoPrompt(r,s,v),"```",`Fala ${v} (literal): ${falaDe(r,s,v)}`,`Legenda na edição ${v} (literal): ${legendaDe(r,s,v)}`,s.morfose?`Morfose: ${s.morfose}`:"",...passos(r,s,v).map((x,i)=>`${i+1}. ${x}`),"");}
  if(r.pos?.length)L.push("## Pós (edição)","",...r.pos.map(x=>`- ${x}`),"");
  if(r.decisoes?.length)L.push("## Decisões pendentes","",...r.decisoes.map(x=>`- ${x}`),"");
  if(issues.length)L.push("## Lint","",...issues.map(x=>`- ${x}`),"");return L.join("\n");
}
