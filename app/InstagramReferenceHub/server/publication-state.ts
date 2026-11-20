export type Publicacao = 'a_publicar' | 'postado' | 'arquivado';
export function publicacaoDe(c: Record<string,string>): Publicacao {
 const st=String(c.publicacao ?? c.status ?? '').toLowerCase();
 if(/arquiv/.test(st)||c.arquivado_em)return 'arquivado';
 return /postad|publicad|no ar/.test(st)?'postado':'a_publicar';
}
export function resumirPublicacoes(campos:Record<string,string>[]) {
 const estados=campos.map(publicacaoDe);
 return estados.length && estados.every(s=>s==='arquivado')?'arquivado':estados.includes('a_publicar')?'a_publicar':estados.includes('postado')?'postado':'a_publicar';
}
