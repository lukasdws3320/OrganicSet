import type { ResumoPosts } from './posts';
/** Projeção única da publicação das notas; o legado só vale onde não há nota. */
export function espelharPublicacao<T extends { etapa: string; status?: Record<string,string>; editado?: unknown }>(item:T, resumo:ResumoPosts|undefined, gerido:boolean): T & { posts?: ResumoPosts; status?: Record<string,string>; postUrl?: string|null } {
 if(!gerido) return item;
 const r=resumo ?? {total:0,postados:0,abertos:0,arquivados:0,post_url:null,postado_em:null,agendado_para:null};
 const publicado=!!r.postados && !r.abertos;
 const status={...item.status};
 if(publicado)status.POSTADO='feito';else delete status.POSTADO;
 const producao=item.etapa==='postado' ? (status.EDITADO==='feito' ? 'pronto':'edicao') : item.etapa;
 return {...item,status,etapa:r.total && r.arquivados===r.total?'descartada':publicado?'postado':producao,
 postUrl:publicado?r.post_url:null,postadoEm:publicado?r.postado_em:null,registradoEm:null,arquivadoEm:null,
 agendado_para:r.agendado_para,posts:r};
}
