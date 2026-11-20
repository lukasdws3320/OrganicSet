"""Janelas de análise limitadas sem descartar ASR ou refazer a leitura visual."""
import re

def literal(words):
 return re.sub(r'\s+([,.!?…])',r'\1',' '.join(w['w'] for w in words)).strip()

# 8,1: trechos por corte de câmera (TROCA DE PRODUTO) até 8,1 s cabem num clipe de 8 s esticado <1,3% na edição.
def analysis_windows(shots,words,limit=8.1):
 out=[]
 for shot in shots:
  start,end=shot['ini'],shot['fim']
  if end-start<=limit+.01:
   out.append({k:shot[k] for k in ('id','ini','fim','fala')});continue
  members=[w for w in words if start<=w['ini']<end]
  if literal(members)!=shot['fala']:raise ValueError('Janela longa não corresponde ao ASR literal; fonte preservada')
  while end-start>limit+.01:
   cap=start+limit
   candidates=[(bool(re.search(r'[.!?…][\"”\']?$',a['w'])),round((a['fim']+b['ini'])/2,6)) for a,b in zip(members,members[1:]) if b['ini']>=a['fim'] and start<(a['fim']+b['ini'])/2<=cap]
   if candidates:cut=max(candidates)[1]
   else:
    cut=cap
    crossing=next((w for w in members if w['ini']<cut<w['fim']),None)
    if crossing:cut=crossing['ini']
   if cut<=start:raise ValueError('Não há fronteira de fala válida em oito segundos; fonte preservada')
   left=[w for w in members if w['ini']<cut];members=[w for w in members if w['ini']>=cut]
   out.append({'id':'','ini':start,'fim':cut,'fala':literal(left)});start=cut
  out.append({'id':'','ini':start,'fim':end,'fala':literal(members)})
 for n,shot in enumerate(out,1):shot['id']=f'SHOT{n:02}'
 return out
