import type { Database } from 'bun:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { joinAutomaticSpeech } from './automatic-map';
import { safeJoin } from './library';
import { hashArquivo, lerAnalise, verificarEvidencias, salvarAnalise, type Analise } from './analise';

/** Confere o mapa por modelo e valida sua proveniência antes de publicá-lo. Não aprova mídia final. */
export async function automaticAnalysis(db:Database,root:string,ref:string){
  const row=db.query('SELECT video_path,duration FROM refs WHERE id=?').get(ref) as any;
  const video=row?.video_path?safeJoin(root,row.video_path):null;
  if(!video||!existsSync(video))throw new Error('Arquivo da referência ausente');
  const dir=join(root,'replicacoes',ref),evidence=join(dir,'evidencias');
  const existing=lerAnalise(dir);
  if(existing){
    const seg=JSON.parse(readFileSync(join(dir,'shots.json'),'utf8'));
    const joined=joinAutomaticSpeech(existing,seg.cortes??[]);
    if(joined!==existing)salvarAnalise(joined,dir,video,ref,row.duration);
    return;
  }
  let feedback='';
  for(let attempt=0;attempt<2;attempt++){
    const args=[process.env.IRH_ANALYSIS_PYTHON??(existsSync('/opt/homebrew/bin/python3')?'/opt/homebrew/bin/python3':'python3'),join(import.meta.dir,'../scripts/conferir-mapa.py'),ref,'--root',root,'--video',video,'--duration',String(row.duration),...(feedback?['--feedback',feedback]:[])];
    const proc=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});
    const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
    try{
      if(code)throw new Error(err.trim()||'Conferência automática falhou');
      const file=join(evidence,'mapa-candidato.json');
      const seg=JSON.parse(readFileSync(join(dir,'shots.json'),'utf8'));
      const map=joinAutomaticSpeech(JSON.parse(readFileSync(file,'utf8')) as Analise,seg.cortes??[]);
      verificarEvidencias(map,dir,video,ref,row.duration);
      // O mapa não pode descartar/reordenar palavras: a segmentação final faz a mesma conferência.
      const words=JSON.parse(readFileSync(join(dir,'transcricao.json'),'utf8')).palavras;
      const literal=(a:any[])=>a.map(w=>w.w).join(' ').replace(/\s+([,.!?…])/g,'$1').trim();
      if(map.shots.map(s=>s.fala).join(' ')!==literal(words))throw new Error('Fala do mapa diverge da transcrição local');
      salvarAnalise(map,dir,video,ref,row.duration);
      writeFileSync(join(evidence,'conferencia-automatica.json'),JSON.stringify({status:'validada',mapa_sha256:hashArquivo(join(dir,'analise.json')),tentativa:attempt+1,saida:out.trim(),concluida_em:new Date().toISOString()},null,2));
      return;
    }catch(error){feedback=(error as Error).message;writeFileSync(join(evidence,'conferencia-erros.json'),JSON.stringify({tentativa:attempt+1,erro:feedback}));}
  }
  throw new Error(`Não foi possível validar o mapa automático: ${feedback}`);
}
