import type { Analise } from './analise';
import { divisaoIndevida } from './replicacao-prompts';

/** Une somente fronteiras que o próprio validador identifica como fala picotada.
 * Takes/estados visuais e fala literal permanecem na ordem original.
 */
export function joinAutomaticSpeech(map:Analise,cuts:number[]):Analise{
  if(map.conferencia?.tipo!=='automatica')return map;
  const copy=structuredClone(map),out:Analise['shots']=[];
  let changed=false;
  const combine=(a:string,b:string)=>a===b?a:[a,b].filter(Boolean).join('; em seguida, ');
  for(const shot of copy.shots){
    const previous=out.at(-1);
    const split=previous&&divisaoIndevida({fala:previous.fala,ini:previous.ini,fim:previous.fim},{fala:shot.fala,ini:shot.ini,fim:shot.fim},cuts,{s:8,palavras:30});
    if(previous&&split){
      copy.decisoes.push(`${previous.id}+${shot.id}: fala contínua reunida (${split.palavras} palavras em ${split.segundos.toFixed(2)}s); estados visuais preservados como takes.`);
      if(previous.camadas&&shot.camadas){
        previous.composicaoSegmentos??=[{ini:previous.ini,fim:previous.fim,fala:previous.fala,camadas:structuredClone(previous.camadas)}];
        previous.composicaoSegmentos.push(...(shot.composicaoSegmentos??[{ini:shot.ini,fim:shot.fim,fala:shot.fala,camadas:structuredClone(shot.camadas)}]));
      }
      previous.fim=shot.fim;previous.fala=[previous.fala,shot.fala].filter(Boolean).join(' ');
      previous.acao=combine(previous.acao,shot.acao);previous.evento=combine(previous.evento,shot.evento);
      if(previous.camadas&&shot.camadas){
        for(const key of ['fundo','react'] as const){
          const before=previous.camadas[key],after=shot.camadas[key];
          if(before&&after){before.acao=combine(before.acao,after.acao);before.presente=before.presente||after.presente;}
        }
      }
      previous.estados.push(...shot.estados);previous.incertezas=[...new Set([...previous.incertezas,...shot.incertezas])];
      changed=true;
    }else out.push(shot);
  }
  if(!changed)return map;
  out.forEach((s,i)=>s.id=`SHOT${String(i+1).padStart(2,'0')}`);copy.shots=out;
  return copy;
}
