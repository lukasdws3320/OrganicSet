import{existsSync,readFileSync,writeFileSync,renameSync}from'node:fs';
/** A persisted label is not a running worker. Old jobs have a bounded lease. */
export function readAnalysisJob(file:string):any{
 if(!existsSync(file))return null;
 const j=JSON.parse(readFileSync(file,'utf8'));if(j.status!=='analisando')return j;
 let dead=false;if(j.worker_pid){try{process.kill(j.worker_pid,0)}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH'}}
 const age=Date.now()-Date.parse(j.iniciado_em),expired=!Number.isFinite(age)||age>20*60e3;
 if(!dead&&!expired)return j;
 const out={...j,status:'erro',finalizado_em:new Date().toISOString(),erro:dead?'O processo de análise foi encerrado; evidências preservadas para retomada.':'Análise sem conclusão no prazo; evidências preservadas para retomada.'};
 writeFileSync(file+'.recover.tmp',JSON.stringify(out));renameSync(file+'.recover.tmp',file);return out;
}
