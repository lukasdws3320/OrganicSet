import { profileAtivo } from "./db";
import {readAnalysisJob} from "./analysis-job";
import { linkReplicationExpert } from "./replication-assignments";
import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { automaticAnalysis } from "./automatic-analysis";
import { lerAnalise, hashArquivo } from "./analise";
import { safeJoin } from "./library";
import { HttpError } from "./refs";
import { FORMATOS, engineValida } from "./replicacao-prompts";
import { formatoDaAnalise } from "./replication-formats";
import { analisarRef, criarReplicacao, segmentarRef } from "./replicacoes";
import { clientSlug } from "./pipeline";
import type { Preparation } from "./replication-preparation-state";
import { preparationFile, readPreparation } from "./replication-preparation-store";

export type PreparationTasks = {
  collect: (ref: string) => Promise<void>;
  review: (ref: string) => Promise<void>;
  segment: (ref: string, formato?: string) => Promise<unknown>;
  create: (input: Preparation["input"]) => unknown;
};

/** Fila persistente. O HTTP só registra o pedido; a conferência nunca vira aprovação implícita. */
export class ReplicationPreparation {
  private pending: Preparation[] = [];
  private active = false;
  private stopped = false;
  private current: Promise<void> = Promise.resolve();
  private tasks: PreparationTasks;
  constructor(private context: { db: Database }, private root: string, overrides: Partial<PreparationTasks> = {}) {
    this.tasks = {
      // TROCA DE PRODUTO reescreve a fala: os trechos seguem os cortes de câmera da referência.
      segment: (ref, formato) => segmentarRef(this.context.db, root, ref, false, 7.5, formato === "TROCA DE PRODUTO"),
      review: ref => automaticAnalysis(this.context.db, root, ref),
      create: input => criarReplicacao(this.context.db, root, input),
      collect: async ref => {
        const file = join(root,"replicacoes",ref,"evidencias/job.json");
        const read = () => readAnalysisJob(file);
        const before = read();
        if (before?.status === "aguardando_conferencia") return;
        if (before?.status !== "analisando") analisarRef(this.context.db,root,ref);
        const deadline = Date.now() + 20*60e3;
        while (!this.stopped && Date.now() < deadline) {
          const job = read();
          if (job?.status === "erro") throw new Error(job.erro || "Não foi possível concluir a dupla leitura visual. As evidências foram preservadas.");
          if (job && job.status !== "analisando") return;
          await Bun.sleep(1000);
        }
        if (!this.stopped) throw new Error("A análise não concluiu no prazo. O pedido foi preservado para retomada.");
      },
      ...overrides,
    };
  }
  private save(p: Preparation) {
    p.atualizado_em = new Date().toISOString();
    const file = preparationFile(this.root,p.ref,p.slug);
    mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file+".tmp",JSON.stringify(p,null,2)+"\n"); renameSync(file+".tmp",file);
  }
  private all(): Preparation[] {
    const dir=join(this.root,"replicacoes");
    if(!existsSync(dir)) return [];
    const out: Preparation[]=[];
    for(const ref of readdirSync(dir,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^REF-\d{4}-\d{2}-\d{4}$/.test(x.name))){
      const own=readPreparation(this.root,ref.name,null); if(own)out.push(own);
      for(const slug of readdirSync(join(dir,ref.name),{withFileTypes:true}).filter(x=>x.isDirectory())){
        const p=readPreparation(this.root,ref.name,slug.name);if(p)out.push(p);
      }
    }
    return out;
  }
  enqueue(input: any) {
    const ref=String(input?.ref??"");
    if(!/^REF-\d{4}-\d{2}-\d{4}$/.test(ref))throw new HttpError(400,"REF inválida");
    const source=this.context.db.query("SELECT video_path FROM refs WHERE id=?").get(ref) as any;
    const video=source?.video_path?safeJoin(this.root,source.video_path):null;
    if(!video||!existsSync(video))throw new HttpError(404,"Referência sem arquivo de vídeo");
    const ex=input?.expert_id?this.context.db.query("SELECT * FROM clients WHERE id=?").get(Number(input.expert_id)) as any:null;
    if(input?.expert_id&&!ex)throw new HttpError(400,"Escolha o expert");
    if(ex&&!ex.avatar)throw new HttpError(400,`Cadastre a contact sheet do avatar em Experts → ${ex.name}.`);
    const facet=this.context.db.query("SELECT v.name FROM ref_facet_values x JOIN facet_values v ON v.id=x.value_id JOIN facets f ON f.id=v.facet_id WHERE x.ref_id=? AND f.key='formato' ORDER BY x.source='manual' DESC LIMIT 1").get(ref) as {name:string}|null;
    const known:Record<string,string>={"Falando pra câmera":"EXPERT","React":"REACT","React + animação":"REACT + ANIMAÇÃO","Receita passo a passo":"RECEITA PASSO A PASSO","CalKramer Expert":"CALKRAMER EXPERT","Personagens falantes":"PERSONAGENS FALANTES","ALW Fruits":"ALW FRUITS"};
    const formato=input?.formato?.trim()||(facet?(known[facet.name]??facet.name):""),engine=input?.engine??"Veo 3";
    if(formato&&!FORMATOS.includes(formato))throw new HttpError(400,"Formato sem playbook");
    if(!engineValida(engine))throw new HttpError(400,"Engine sem template");
    // Slug congelado do personagem (clients.slug), o mesmo das pastas existentes: nunca recalculado do nome.
    const slug=ex?clientSlug(ex):null,id=slug?`${ref}--${slug}`:ref;
    if(slug&&existsSync(join(this.root,"replicacoes",ref,slug,"replicacao.json"))){if(ex)linkReplicationExpert(this.context.db,ref,ex.id);return {id,existente:true};}
    const old=readPreparation(this.root,ref,slug);
    if(old && old.status!=="erro"){if(ex)linkReplicationExpert(this.context.db,ref,ex.id);return {id,preparacao:old};}
    if(ex && !old && !profileAtivo(ex.slug))throw new HttpError(409,"Perfil inativo para novas replicações; selecione Nutri Giovana (realista).");
    if(ex)linkReplicationExpert(this.context.db,ref,ex.id);
    const p:Preparation={schema:1,id,ref,slug,expert:ex?.name??null,input:{ref,...(ex?{expert_id:ex.id}:{}),formato,engine},status:"fila",criado_em:old?.criado_em??new Date().toISOString(),atualizado_em:new Date().toISOString()};
    this.save(p);this.pending.push(p);this.start();
    return {id,preparacao:p};
  }
  resume(ref?: string) {
    for(const p of this.all().sort((a,b)=>a.criado_em.localeCompare(b.criado_em))) {
      if(ref&&p.ref!==ref)continue;
      if(this.active&&this.pending.some(x=>x.id===p.id))continue;
      if(p.status==="fila"||(!this.active&&p.status==="preparando")||(p.status==="aguardando_conferencia")||(p.status==="erro"&&lerAnalise(join(this.root,"replicacoes",p.ref)))){
        if(this.pending.some(x=>x.id===p.id))continue;
        p.status="fila";this.save(p);this.pending.push(p);
      }
    }
    this.start();
  }
  private start() {
    if(this.active||this.stopped||!this.pending.length)return;
    this.active=true;
    // A resposta de aceitação não aguarda trabalho nem providers.
    this.current=new Promise<void>(resolve=>setTimeout(resolve,0)).then(async()=>{
      while(this.pending.length&&!this.stopped){
        const p=this.pending.shift()!;
        try {
          p.status="preparando";p.fase="segmentando";delete p.erro;this.save(p);
          const dir=join(this.root,"replicacoes",p.ref);
          let analysis=lerAnalise(dir);
          if(p.slug&&!analysis){
            const previewFile=join(dir,"shots.json"),preview=existsSync(previewFile)?JSON.parse(readFileSync(previewFile,"utf8")):null;
            if(!preview||preview.shots.some((s:any)=>s.fim-s.ini>8.11))await this.tasks.segment(p.ref,p.input.formato);
            if(this.stopped)break;
            p.fase="analisando";this.save(p);
            await this.tasks.collect(p.ref);if(this.stopped)break;
            p.fase="conferindo";this.save(p);
            await this.tasks.review(p.ref);if(this.stopped)break;
            analysis=lerAnalise(dir);
          }
          // Mapa já usado por outro personagem fica como está: reescrevê-lo mudaria o hash e bloquearia as replicações validadas.
          const inUse=existsSync(dir)&&readdirSync(dir,{withFileTypes:true}).some(e=>e.isDirectory()&&existsSync(join(dir,e.name,"replicacao.json")));
          if(p.slug&&analysis?.conferencia?.tipo==="automatica"&&!inUse){
            await this.tasks.review(p.ref);if(this.stopped)break;analysis=lerAnalise(dir);
          }
          if(p.slug&&!analysis)throw new Error("A conferência automática não produziu um mapa validado; consulte os detalhes da preparação.");
          const segfile=join(dir,"shots.json"),seg=existsSync(segfile)?JSON.parse(readFileSync(segfile,"utf8")):null;
          if(!seg||(analysis&&seg.analise_sha256!==hashArquivo(join(dir,"analise.json"))))await this.tasks.segment(p.ref,p.input.formato);
          if(this.stopped)break;
          p.fase="prompts";this.save(p);
          if(p.slug&&!existsSync(join(dir,p.slug,"replicacao.json"))){
            if(!p.input.formato){p.input.formato=formatoDaAnalise(analysis!);this.save(p);}
            this.tasks.create(p.input);
          }
          p.status="pronto";this.save(p);
        }catch(error){if(!this.stopped){p.status="erro";p.erro=error instanceof Error?error.message:String(error);this.save(p);}}
      }
    }).finally(()=>{this.active=false;if(!this.stopped)this.start();});
  }
  async idle(){await this.current;}
  stop(){this.stopped=true;}
}
