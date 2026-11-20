import assert from'node:assert/strict';
import{readFileSync,existsSync}from'node:fs';import{join,resolve}from'node:path';
import{verificarEvidencias,hashArquivo,lerAnalise}from'../server/analise';
import{anexosStill,problemas,falaDe,legendaDe,markdown,videoPrompt,passos,FORMATOS,type ReplicacaoV2}from'../server/replicacao-prompts';
const root=resolve(import.meta.dir,'..'),e=join(root,'docs/evidencias/revisao-2026-10-17'),mode=process.argv[2];
const refs=['REF-2026-10-0009','REF-2026-10-0003','REF-2026-10-0001'];
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
function dados(ref:string){const d=join(root,'library/replicacoes',ref);return{d,a:lerAnalise(d)!,seg:read(join(d,'shots.json')),rep:read(join(d,'bruno-goytacazes/replicacao.json'))as ReplicacaoV2};}
function run(args:string[]){const p=Bun.spawnSync([process.execPath,...args],{cwd:root,stdout:'pipe',stderr:'pipe'});const out=Buffer.concat([p.stdout,p.stderr]).toString();assert.equal(p.exitCode,0,out);console.log(out.slice(-1100));}
function verificarRef(ref:string){
 const{d,a,seg,rep}=dados(ref);assert(a&&a.versao===1);verificarEvidencias(a,d,seg.video,ref,seg.duracao);
 assert.equal(seg.analise_sha256,hashArquivo(join(d,'analise.json')));assert.equal(rep.analise_sha256,seg.analise_sha256);
 assert.deepEqual(problemas(rep,seg).filter(p=>p.nivel==='erro'),[]);
 assert(!JSON.stringify(rep).includes('prompt_override'));assert.equal(rep.shots.length,a.shots.length);
 const ws=read(join(d,'transcricao.json')).palavras.map((w:any)=>w.w).join(' ');assert.equal(a.shots.map(s=>s.fala).filter(Boolean).join(' '),ws);
 for(const s of seg.shots)for(const t of s.takes){assert(t.t_frame>=t.ini-.001&&t.t_frame<t.fim);assert.equal(hashArquivo(join(d,t.frame)),t.frame_sha256);assert(t.estado_visual.evidencia.frame_sha256);}
 for(const st of rep.stills){assert.equal(hashArquivo(join(d,st.frame)),st.frame_sha256);assert(anexosStill(rep,st).some(x=>x.arquivo===st.frame));}
 for(const v of rep.copy.versoes){const md=markdown(rep,seg,v.id);for(const s of rep.shots){const f=falaDe(rep,s,v.id);assert(md.includes(`Fala ${v.id} (literal): ${f}`));assert(md.includes(`Legenda na edição ${v.id} (literal): ${legendaDe(rep,s,v.id)}`));if(s.tipo.startsWith('falado'))assert(videoPrompt(rep,s,v.id).includes(`diz: "${f}"`));else if(f)assert(passos(rep,s,v.id).some(x=>x.includes(f)));}}
 assert(existsSync(join(e,`${ref}-verificacao.json`)),'Falta revisão visual registrada por REF');
 if(ref.endsWith('0009')){const first=rep.shots.slice(0,3);for(const k of ['acao','still','referencia_take','estado_inicial']as const)assert.equal(new Set(first.map(s=>s[k])).size,3);assert.equal(rep.formato,FORMATOS[3]);}
 if(ref.endsWith('0001')){assert(rep.copy.versoes.some(v=>v.id==='V2'));for(const v of rep.copy.versoes)assert(!rep.shots.map(s=>falaDe(rep,s,v.id)).join(' ').includes('centenas de pessoas'));}
}
if(mode==='baseline'){
 assert(existsSync(join(e,'antes.zip')));const p=Bun.spawnSync(['/opt/homebrew/bin/python3','-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert "server/segmentar.ts" in z.namelist(); assert "git-status.txt" in z.namelist()',join(e,'antes.zip')]);assert.equal(p.exitCode,0);
 const source=read(join(e,'watch-proveniencia.json'));assert.equal(source.versao,'0.3.2');assert.equal(source.upstream,'https://github.com/bradautomates/claude-video');
}else if(refs.includes(mode)){verificarRef(mode);
}else if(mode==='analise'){for(const ref of refs)verificarRef(ref);run(['test','tests/api.test.ts']);
}else if(mode==='segmentacao'){run(['test','tests/segmentar.test.ts','tests/replicacao-revisao.test.ts']);
}else if(mode==='templates'){run(['test','tests/replicacao-revisao.test.ts','-t','quatro playbooks']);
}else if(mode==='copy'){run(['test','tests/replicacao-revisao.test.ts','-t','V2 literal']);for(const ref of refs)verificarRef(ref);
}else if(mode==='lint'){run(['test','tests/replicacao-revisao.test.ts','-t','lint reprova|objeto ausente|mesmos pixels']);
}else if(mode==='skill'){
 const s=readFileSync(join(root,'.claude/skills/replicar-referencia/SKILL.md'),'utf8');for(const token of ['análise dupla','analise.json','REAL→3D MESMO ÂNGULO','RECEITA POV','REACT','EXPERT','Seedance','Omni/Flow','bloqueada','GATES.md'])assert(s.includes(token),token);
}else if(mode==='checks'){run(['test']);run(['x','tsc','--noEmit','-p','.']);run(['run','build']);
}else if(mode==='ui'){
 const ui=read(join(e,'ui.json'));assert(ui.realizado_no_navegador);assert(ui.engine_seedance);assert(ui.bloqueio_react);assert(ui.v2_literal);assert(ui.editor_copy);assert(ui.refs.length===3);
 for(const item of ui.refs){assert(item.carregou);assert(item.imagens_visiveis_ok);assert.equal(hashArquivo(join(e,item.screenshot)),item.sha256);}
 assert.equal(hashArquivo(join(e,ui.bloqueio.screenshot)),ui.bloqueio.sha256);
}else throw new Error('Modo desconhecido');
console.log(`REVISAO_OK ${mode}`);
