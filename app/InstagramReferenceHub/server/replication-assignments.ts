import type { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Vínculos aditivos: replicar para outro expert nunca remove atribuições anteriores. */
export function linkReplicationExpert(db:Database,ref:string,expertId:number){
  db.run('INSERT OR IGNORE INTO ref_clients (ref_id,client_id) VALUES (?,?)',[ref,expertId]);
}

export function syncReplicationExperts(db:Database,root:string){
  const base=join(root,'replicacoes'),linked:{ref:string;expert_id:number}[]=[],unresolved:string[]=[];
  if(!existsSync(base))return {linked,unresolved};
  const read=(p:string)=>{try{return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null;}catch{return null;}};
  db.transaction(()=>{
    for(const ref of readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^REF-\d{4}-\d{2}-\d{4}$/.test(x.name))){
      if(!db.query('SELECT 1 FROM refs WHERE id=?').get(ref.name))continue;
      for(const dir of readdirSync(join(base,ref.name),{withFileTypes:true}).filter(x=>x.isDirectory())){
        const path=join(base,ref.name,dir.name),rep=read(join(path,'replicacao.json')),prep=read(join(path,'preparacao.json'));
        if(!rep&&!prep)continue;
        // Pedido persistido guarda o ID; trabalhos antigos são resolvidos pelo nome exato do cadastro.
        // A pasta é o slug do expert (não muda quando o nome muda); o nome exato fica como último recurso.
        const expert=(prep?.input?.expert_id?db.query('SELECT id FROM clients WHERE id=?').get(prep.input.expert_id) as any:null)
          ??db.query('SELECT id FROM clients WHERE slug=?').get(dir.name) as any
          ??db.query('SELECT id FROM clients WHERE name=? COLLATE NOCASE').get(rep?.expert??'') as any;
        if(!expert){unresolved.push(`${ref.name}--${dir.name}`);continue;}
        if(!db.query('SELECT 1 FROM ref_clients WHERE ref_id=? AND client_id=?').get(ref.name,expert.id)){
          linkReplicationExpert(db,ref.name,expert.id);linked.push({ref:ref.name,expert_id:expert.id});
        }
      }
    }
  })();
  return {linked,unresolved};
}
