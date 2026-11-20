#!/usr/bin/env python3
"""Gera a agenda vigente em HTML (checklist, legenda com copiar) a partir da lista de posts do Hub. Roda depois de recalcular."""
import json,re,html,urllib.request,urllib.parse,os,datetime as dt
H="http://127.0.0.1:4317"
import os
BASE=os.path.join(os.environ.get("IRH_VAULT") or os.path.abspath(os.path.join(os.path.dirname(__file__),"../../..")),"experts")
PERF={"bruno-goytacaz":("Bruno Goytacaz","@otimedasestrelas",f"{BASE}/01_experts/Bruno Goytacaz"),
      "mini-chefs-da-vovo":("Mini Chefs da Vovó","@minichefsdavovo",f"{BASE}/02_experts-ia/Mini Chefs da Vovó")}
L=json.load(urllib.request.urlopen(f"{H}/api/posts",timeout=10))['itens']
# campos que a API não expõe: caminho do vídeo e revisão técnica, direto da nota
meta={}
for slug,(n,h,pasta) in PERF.items():
  sec=None
  for ln in open(f"{pasta}/06_roadmap/Postagens.md",encoding="utf-8"):
    if ln.startswith("## "): sec={}
    elif sec is not None:
      m=re.match(r"(id|video|revisao_tecnica):\s*(.*)",ln)
      if m:
        sec[m[1]]=m[2].strip()
        if m[1]=="id": meta[m[2].strip()]=sec
ini=dt.date.today().isoformat()
ab=[p for p in L if p['publicacao'] in('a_publicar','postado') and p['perfil']['slug'] in PERF and ini<=(p['data'] or '')]
ab.sort(key=lambda p:(p['data'],p['perfil']['slug'],p['hora']))
fim=max(p['data'] for p in ab)
OUT=f"{BASE}/03_cronograma-postagens/{ini} a {fim[-2:]} — Agenda vigente — Bruno e Mini Chefs.html"
DIAS=["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"]
e=html.escape
faltam=[];cont={}
corpo=""
dias=sorted({p['data'] for p in ab})
resumo=""
for d in dias:
  D=dt.date.fromisoformat(d)
  corpo+=f"<section><h2>{DIAS[D.weekday()]} · {D:%d/%m}</h2>"
  linha=[]
  for slug,(nome,handle,pasta) in PERF.items():
    ps=[p for p in ab if p['data']==d and p['perfil']['slug']==slug]
    if not ps: continue
    cont[slug]=cont.get(slug,0)+len(ps); linha.append(f"{nome}: {len(ps)}")
    corpo+=f"<div class='group'><h3>{e(nome)} <span>{e(handle)} · {len(ps)} posts</span></h3>"
    for p in ps:
      m=meta.get(p['id'],{})
      v=m.get('video','')
      arq=v if v.startswith('/') else os.path.join(pasta,v) if v else ''
      if not arq or not os.path.exists(arq): faltam.append((p['id'],arq)); arq=''
      if slug=="bruno-goytacaz":
        tag="IA" if p.get('ref') else "Repostagem"
        if m.get('revisao_tecnica'): tag+=" · revisão: "+m['revisao_tecnica'].replace('_',' ')
      else:
        tag=(p.get('personagem') or '').rsplit('-',1)[-1].capitalize()+" · "+(p.get('versao') or '')
        if p.get('legenda_fonte')=='referencia': tag+=" · legenda da referência"
        if p.get('canal'): tag+=' · '+p['canal']
      if p['publicacao']=='postado': tag='Já postado · '+tag
      tit=re.sub(r"\s*·\s*V\d+$","",p.get('titulo') or '')
      links=[]
      if arq: links.append(f"<a href='{e('file://'+urllib.parse.quote(arq))}'>Abrir arquivo</a>")
      if p.get('video'): links.append(f"<a href='{e(H+p['video'])}'>Assistir</a>")
      if p.get('hub_url'): links.append(f"<a href='{e(H+p['hub_url'])}'>Registrar publicação</a>")
      leg=p.get('legenda') or ''
      det=f"<details><summary>Legenda</summary><pre>{e(leg)}</pre><button onclick='copiar(this)'>Copiar legenda</button></details>" if leg else "<p class='alerta'>Sem legenda</p>"
      corpo+=f"<article><label><input type='checkbox' data-id='{e(p['id'])}'{' checked disabled' if p['publicacao']=='postado' else ''}><b>{p['hora']}</b> {e(tit)}</label><p class='tag'>{e(tag)}</p><nav>{' · '.join(links)}</nav>{det}</article>"
    corpo+="</div>"
  corpo+="</section>"
  resumo+=f"<li>{DIAS[D.weekday()]} {D:%d/%m} — {' · '.join(linha)}</li>"
doc=f"""<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agenda da semana</title><style>
:root{{color-scheme:dark}}*{{box-sizing:border-box}}body{{background:#000;color:#fff;font:16px/1.45 system-ui;max-width:900px;margin:0 auto;padding:24px 16px 64px}}h1{{margin:0 0 8px;font-size:28px}}h2{{color:#EE794E;margin:36px 0 12px;font-size:22px;border-bottom:1px solid #333;padding-bottom:8px}}h3{{margin:18px 0 8px;font-size:16px}}h3 span{{color:#999;font-weight:400;font-size:14px}}article{{border:1px solid #333;border-radius:8px;padding:12px 14px;margin:8px 0;background:#111}}label{{display:flex;gap:10px;align-items:flex-start;cursor:pointer;overflow-wrap:anywhere}}label b{{color:#EE794E;font-variant-numeric:tabular-nums}}input{{width:20px;height:20px;flex:none;margin:1px 0 0;accent-color:#EE794E}}article:has(input:checked){{opacity:.45}}.tag{{color:#999;font-size:13px;margin:6px 0 6px 30px}}nav{{margin-left:30px;font-size:14px}}a{{color:#EE794E}}details{{margin:8px 0 0 30px}}summary{{cursor:pointer;color:#ccc;font-size:14px}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.45 system-ui;color:#ddd}}button{{padding:8px 12px;cursor:pointer;background:#222;color:#fff;border:1px solid #444;border-radius:6px}}p{{color:#ccc}}ul{{color:#ccc;padding-left:20px}}.alerta{{color:#EE794E;margin-left:30px}}
</style><h1>Agenda · {ini[-2:]}/{ini[5:7]} a {fim[-2:]}/{fim[5:7]}</h1><p>Horário de Brasília. Quem publica é o Matheus. O checklist fica só neste navegador: para marcar como postado no Hub, use “Registrar publicação”; o lembrete do horário conclui sozinho.</p><ul>{resumo}</ul>{corpo}
<script>const key="agenda-{ini}";let v={{}};try{{v=JSON.parse(localStorage.getItem(key)||"{{}}")}}catch(e){{}}document.querySelectorAll("input[data-id]:not([disabled])").forEach(x=>{{x.checked=!!v[x.dataset.id];x.onchange=()=>{{v[x.dataset.id]=x.checked;try{{localStorage.setItem(key,JSON.stringify(v))}}catch(e){{}}}}}});async function copiar(b){{const t=b.previousElementSibling.innerText;try{{await navigator.clipboard.writeText(t)}}catch(e){{let a=document.createElement("textarea");a.value=t;document.body.append(a);a.select();document.execCommand("copy");a.remove()}}b.textContent="Copiado"}}</script></html>"""
open(OUT,"w",encoding="utf-8").write(doc)
print(OUT);print(len(ab),cont)
