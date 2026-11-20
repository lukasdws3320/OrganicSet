import argparse,hashlib,importlib.util,json,re,sys,time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
import os
sys.path.insert(0,str(Path(__file__).resolve().parent))
from flow_control import FlowControl,operation_lock_path
from flow_plan import load_plan,project_key,write_json,attachment_prompt,aliases_for
import flow_originals as c
GRID='div.page-container.cdk-virtual-scrollable'
def norm(s):return re.sub(r'\s+',' ',str(s)).strip()
def media_surface(kind):
 if kind=='still':return {'tab':'Images','tile':'flow-image-tile','media':'img[data-media-id]'}
 return {'tab':'Videos','tile':'flow-video-tile','media':'video[aria-label="Generated video"],img[alt="Generated video thumbnail"]'}
class CollectionScanIndex:
 """One editor inspection per asset, persisted across jobs and sessions."""
 def __init__(self,path):
  self.path=Path(path)
  try:self.entries=json.loads(self.path.read_text()).get('assets',{})
  except (OSError,ValueError):self.entries={}
 def keys(self,tile):
  keys=[]
  if tile.get('assetId'):return ['id:'+tile['assetId']]
  if tile.get('src'):
   u=urlsplit(tile['src']);signature={'token','signature','expires','googleaccessid','policy','key-pair-id'}
   query=[(k,v) for k,v in parse_qsl(u.query,keep_blank_values=True) if k.lower() not in signature and not k.lower().startswith(('x-goog-','x-amz-'))]
   keys.append('src:'+urlunsplit((u.scheme,u.netloc,u.path,urlencode(query),'')))
  name=tile.get('name','')
  if name.startswith('REF-') and re.search(r'_[a-f0-9]{10}$',name):keys.append('name:'+name)
  return keys
 def entry(self,tile):
  return next((self.entries[k] for k in self.keys(tile) if k in self.entries),None)
 def save(self,tile,entry):
  for key in self.keys(tile):self.entries[key]=entry
  self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  temp=self.path.with_suffix('.tmp');temp.write_text(json.dumps({'schema':'flow-collection-scan/v1','assets':self.entries},ensure_ascii=False));os.chmod(temp,0o600);temp.replace(self.path)
 def should_open(self,tile,prompts):
  entry=self.entry(tile)
  if not entry:return True
  if entry.get('downloaded'):return False
  if entry.get('downloadError') and (entry.get('permanent') or entry.get('attempts',0)>=2 or time.time()-entry.get('failedAt',0)<60):return False
  if entry.get('downloadError'):return True
  return any(prompt in entry.get('text','') for prompt in prompts)
 def observed(self,tile,editor,text):self.save(tile,{**(self.entry(tile) or {}),'editorId':editor,'text':text,'observedAt':time.time()})
 def downloaded(self,tile):self.save(tile,{**(self.entry(tile) or {}),'downloaded':True})
 def failed(self,tile,error,permanent=False,item=None):
  entry=self.entry(tile) or {};self.save(tile,{**entry,'downloadError':str(error),'failedAt':time.time(),'attempts':entry.get('attempts',0)+1,'permanent':permanent,'item':item})
 def reset_failures(self,prompts):
  for key,entry in list(self.entries.items()):
   if entry.get('downloadError') and (not entry.get('text') or any(p in entry.get('text','') for p in prompts)):
    self.entries[key]={k:v for k,v in entry.items() if k not in {'downloadError','failedAt','attempts','permanent'}}
  self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);self.path.write_text(json.dumps({'schema':'flow-collection-scan/v1','assets':self.entries},ensure_ascii=False));self.path.chmod(0o600)

def editor_ready_text(flow,timeout=5,clock=time.monotonic,sleep=time.sleep):
 deadline=clock()+timeout;previous=None;stable=0
 while clock()<deadline:
  names={n.get('name',{}).get('value') for n in flow.ax() if not n.get('ignored')}
  text=norm(flow.js('document.body.innerText'))
  ready=bool(names.intersection({'Done editing','Done editing scene'}))
  stable=stable+1 if text==previous else 0;previous=text
  # O marcador fica no fim do prompt e comprova que o conteúdo da tentativa chegou ao editor.
  if ready and stable>=2 and re.search(r'IRH:[^\s]+:A\d+',text):return text
  if ready and stable>=3 and len(text)>200 and re.search(r'\bprompt\b',text,re.I):return text
  sleep(.2)
 raise TimeoutError('Editor não carregou o prompt completo; a leitura não foi gravada como alheia')

def collected_output_name(name):
 return bool(re.match(r'^REF-\d{4}-\d{2}-\d{4}_SHOT\d+_',name))

def clear_reused_prompt(flow,expected):
 # Só apaga o texto carregado por esta inspeção; nunca um rascunho alheio.
 current=flow.composer_snapshot()['prompt']
 if norm(current)!=norm(expected):raise RuntimeError('Prompt mudou durante leitura de falha; rascunho preservado')
 flow.js("(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return true})()")
 flow.key('Backspace')
 if norm(flow.composer_snapshot()['prompt']):raise RuntimeError('Não foi possível limpar o prompt de inspeção; nenhuma geração foi acionada')

def inspect_provider_errors(flow,ctx,index):
 """Lê falhas pelo Reuse prompt, sem Retry, geração, exclusão ou abrir editor."""
 if not ctx:return []
 rows=flow.js("(()=>[...document.querySelectorAll('flow-error-tile')].map(e=>({name:e.closest('flow-grid-tile-container')?.getAttribute('aria-label')||'',error:e.querySelector('.error-message-text')?.innerText||e.innerText})))()")
 scope=hashlib.sha256('|'.join(sorted(x['row'].get('submissionTag','') or x['prompt'] for x in ctx.values())).encode()).hexdigest()
 failures=[]
 for ordinal,row in enumerate(rows):
  key='failure:'+scope+':'+hashlib.sha256((row['name']+'|'+row['error']+'|'+str(ordinal)).encode()).hexdigest()
  cached=index.entries.get(key)
  if cached:
   if cached.get('failure'):failures.append({**cached['failure'],'kind':'provider_refused'})
   continue
  if norm(flow.composer_snapshot()['prompt']):break # preserva rascunho do usuário/envio incerto
  clicked=flow.js("(()=>{const e=[...document.querySelectorAll('flow-error-tile')]["+str(ordinal)+"];if(!e||e.closest('flow-grid-tile-container')?.getAttribute('aria-label')!=="+json.dumps(row['name'])+")return false;const b=e.querySelector('button[aria-label=\"Reuse prompt\"]');if(!b)return false;b.click();return true})()")
  if not clicked:continue
  prompt='';previous=None;stable=0
  for _ in range(30):
   prompt=flow.composer_snapshot()['prompt'];stable=stable+1 if prompt==previous else 0;previous=prompt
   if stable>=2 and re.search(r'IRH:[^\s]+:A\d+',prompt):break
   time.sleep(.1)
  if not norm(prompt):continue
  matches=[(k,x) for k,x in ctx.items() if x['row'].get('submissionTag') and x['row']['submissionTag'] in prompt and x['prompt'] in norm(prompt)]
  failure=None
  if len(matches)==1:
   item,x=matches[0];failure={'item':item,'error':norm(row['error']),'terminal':True,'kind':'provider_refused','submissionTag':x['row']['submissionTag']}
   failures.append(failure)
  clear_reused_prompt(flow,prompt)
  # Index privado: a chave inclui as tentativas pendentes, evitando confundir nova tentativa de mesmo nome.
  index.entries[key]={'failure':failure,'observedAt':time.time()};index.save({}, {})
 return failures

def remote_name(plan,row):
 base=plan['ref']+'_'+row['id']+'_'+re.sub(r'[^A-Za-z0-9]+','_',plan.get('expert','GERADO')).strip('_')
 tag=row.get('submissionTag')
 return base+'_'+hashlib.sha256(tag.encode()).hexdigest()[:10] if tag else base

def close(f):
 if '/edit/' not in f.js('location.href'):return
 ns={n.get('name',{}).get('value') for n in f.ax() if not n.get('ignored')}
 f.click('button','Done editing scene' if 'Done editing scene' in ns else 'Done editing')
 for _ in range(50):
  if '/edit/' not in f.js('location.href'):return
  time.sleep(.1)
 raise RuntimeError('Editor did not close')
def scroll(f,top):
 f.js('document.querySelector('+json.dumps(GRID)+').scrollTo({top:'+str(max(top,0))+",behavior:'instant'})");time.sleep(.3)
def open_scope(f,scope,project_url):
 """collection: varre a superfície já aberta (coleção da REF). project: abre a raiz do próprio projeto (todas as mídias),
 para achar resultado salvo fora da coleção; o casamento continua exigindo prompt completo + mesmo projeto."""
 if scope!='project':return
 close(f);root=project_url.split('?')[0].rstrip('/')
 if not re.fullmatch(r'https://flow\.google\.com/project/[A-Za-z0-9-]+',root):raise ValueError('Pinned project root URL is invalid')
 f.js('location.href='+json.dumps(root+'?hl=en')+';true')
 for _ in range(120):
  url=f.js('location.href')
  if url.split('?')[0].rstrip('/')==root and f.js('!!document.querySelector('+json.dumps(GRID)+')'):return
  time.sleep(.1)
 raise RuntimeError('Project media view did not open')
def main():
 ap=argparse.ArgumentParser();ap.add_argument('plans',nargs='+');ap.add_argument('--skip',action='append',default=[]);ap.add_argument('--cycles',type=int,default=5);ap.add_argument('--retry-downloads',action='store_true');ap.add_argument('--kind',choices=['still','shot'],default='shot');ap.add_argument('--scope',choices=['collection','project'],default='collection');a=ap.parse_args();surface=media_surface(a.kind)
 ctx={};projects=set();failures=[]
 for v in a.plans:
  p=Path(v).resolve();plan,psha=load_plan(p);root=Path(plan['outputDir']);st=json.loads((root/'flow-run.json').read_text());projects.add(project_key(st['project']))
  for row in plan['stills' if a.kind=='still' else 'shots']:
   key=plan['ref']+':'+row['id'];item=st['items'].get(row['id'],{})
   if key in a.skip or item.get('status')=='available':
    ctx.pop(key,None);continue
   if item.get('status') not in ['submitted','uncertain','submission_intent']:continue
   if a.kind=='still' and (not row.get('submissionTag') or row['submissionTag'] not in row['prompt']):
    raise ValueError('Image collection requires a unique submissionTag in the pinned prompt; recover legacy images by explicit observed asset ID')
   prompt=attachment_prompt(row,plan['assets'],aliases_for(plan,root)) if a.kind=='still' else row['prompt']
   ctx[key]={'path':p,'plan':plan,'root':root,'row':row,'item':item,'prompt':norm(prompt),'project':st['project']}
 if not ctx:print(json.dumps({'pending':0}));return
 if len(projects)!=1:raise RuntimeError('Plans must share pinned project')
 project=projects.pop();f=FlowControl()
 if project_key(f.js('location.href'))!=project:raise RuntimeError('Wrong Flow project')
 open_scope(f,a.scope,next(iter(ctx.values()))['project'])
 scan_root=Path(os.environ.get("FLOW_MEDIA_SCAN_DIR",str(Path.home()/".config/google-flow-mcp/state/collection-scans")))
 index=CollectionScanIndex(scan_root/(hashlib.sha256((project+":"+a.kind).encode()).hexdigest()+".json"))
 if a.retry_downloads:index.reset_failures([x['prompt'] for x in ctx.values()])
 visited=set()
 for cycle in range(a.cycles):
  close(f);f.key('Escape')
  if cycle==0:f.click('button',surface['tab']);time.sleep(.3)
  scroll(f,0)
  for page in range(250):
   dims=f.js('(()=>{const e=document.querySelector('+json.dumps(GRID)+');return{top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}})()');top=dims['top']
   tiles=f.js('(()=>[...document.querySelectorAll('+json.dumps(surface['tile'])+')].map(e=>{const media=e.querySelector('+json.dumps(surface['media'])+');return{src:media?.getAttribute("src")||"",assetId:media?.getAttribute("data-media-id")||"",text:e.innerText||"",name:e.closest("flow-grid-tile-container")?.getAttribute("aria-label")||""}}))()')
   # Falha do provedor vale para imagem e vídeo (OrganicSet, 09/11/2026): sem isto, imagem recusada ficava "enviada" para sempre.
   failures.extend(inspect_provider_errors(f,ctx,index))
   for t in tiles:
    if not t['src'] or t['src'] in visited or re.search(r'Generating|Queued|\d+%',t['text']):continue
    if collected_output_name(t.get('name','')) and not any(t['name'] in (remote_name(x['plan'],x['row']),re.sub(r'_[a-f0-9]{10}$','',remote_name(x['plan'],x['row']))) for x in ctx.values()):continue
    if not index.should_open(t,[x['prompt'] for x in ctx.values()]):
     prior=index.entry(t) or {}
     if prior.get('item') and (prior.get('permanent') or prior.get('attempts',0)>=2):failures.append({'item':prior['item'],'error':prior['downloadError'],'terminal':True})
     continue
    scroll(f,top)
    selector=','.join(surface['tile']+' '+s for s in surface['media'].split(','))
    clicked=f.js('(()=>{const e=[...document.querySelectorAll('+json.dumps(selector)+')].find(e=>e.getAttribute("src")==='+json.dumps(t['src'])+');if(!e)return false;e.click();return true})()')
    if not clicked:continue
    for _ in range(40):
     url=f.js('location.href')
     if '/edit/' in url:break
     time.sleep(.1)
    if '/edit/' not in url:continue
    if project_key(url)!=project:raise RuntimeError('Wrong editor project')
    try:text=editor_ready_text(f)
    except TimeoutError as error:
     index.failed(t,error);close(f);visited.add(t['src']);continue
    editor=url.split('/edit/')[1].split('?')[0].split('/')[0];index.observed(t,editor,text);matches=[k for k,x in ctx.items() if x['prompt'] in text]
    # The unique full prompt maps to a submitted item whose exact source image was recorded before generation.
    if len(matches)!=1:
     debug=Path(next(iter(ctx.values()))['root'])/'unmatched-editors';debug.mkdir(exist_ok=True);eid=url.split('/edit/')[1].split('?')[0].split('/')[0];(debug/(eid+'.txt')).write_text(text);visited.add(t['src']);close(f);continue
    key=matches[0];x=ctx[key];row=x['row'];editor=url.split('/edit/')[1].split('?')[0].split('/')[0];name=remote_name(x['plan'],row)
    f.fill(name,'input[aria-label="Editable text"]');f.click('button','Done');t['name']=name;index.observed(t,editor,text)
    # Falha no download não pode deixar a aba no editor: o próximo ciclo precisa da biblioteca.
    try:result=c.collect(SimpleNamespace(plan=str(x['path']),kind=a.kind,item=row['id'],asset_id=t.get('assetId') or editor,editor_id=editor,picker_name=name,project=project,quote=x['item']['quotedCredits'],timeout=60))
    except Exception as error:
     permanent=bool(re.search(r'hash|duration differs|Different output',str(error),re.I));index.failed(t,error,permanent,key);failures.append({'item':key,'error':str(error),'terminal':permanent or (index.entry(t) or {}).get('attempts',0)>=2});close(f);visited.add(t['src']);continue
    print(json.dumps({'item':key,'file':result['record']['file'],'measuredDuration':result['receipt'].get('measuredDuration'),'generationRetried':False}),flush=True)
    index.downloaded(t);ctx.pop(key);visited.add(t['src']);close(f);scroll(f,top)
    if not ctx:print(json.dumps({'pending':0}));return
   dims=f.js('(()=>{const e=document.querySelector('+json.dumps(GRID)+');return{top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}})()')
   if dims['top']+dims['height']>=dims['total']-2:break
   scroll(f,dims['top']+dims['height']*.75)
  time.sleep(1)
 print(json.dumps({'pending':list(ctx),'failures':failures,'generationRetried':False}),flush=True)
if __name__=='__main__':
 try:
  import fcntl
  import os
  download=Path.home()/'.config/google-flow-mcp/state/download-operation.lock'
  operation=operation_lock_path();download.parent.mkdir(parents=True,exist_ok=True);operation.parent.mkdir(parents=True,exist_ok=True)
  # All tabs share Chrome's downloads. Both this global lock and the tab lock must be held.
  with download.open('a') as dl,operation.open('a') as lock:
   fcntl.flock(dl,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);main()
 except Exception as e:print(json.dumps({'error':str(e),'generationRetried':False}),flush=True);raise SystemExit(1)
