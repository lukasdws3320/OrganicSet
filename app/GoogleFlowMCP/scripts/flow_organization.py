"""Expert project / reference collection operations through the visible Flow UI."""
import base64,json,re,time
from pathlib import Path
from urllib.parse import urlparse

def verify_expert(page,expert,project=None):
 if not expert.strip() or len(expert)>160:raise ValueError('Provide the exact expert project name')
 parsed=urlparse(page['url'])
 match=re.match(r'^/project/([^/]+)',parsed.path)
 if parsed.scheme!='https' or parsed.hostname!='flow.google.com' or not match:raise ValueError('Open the expert Flow project')
 root='https://flow.google.com/project/'+match[1]
 if project and root!=project.rstrip('/'):raise ValueError('Flow project ID differs from the pinned expert project')
 title_match=re.search(r'Google Flow\s*[:\-]\s*(.+)$',page['title'])
 if not title_match or title_match.group(1).strip()!=expert:raise ValueError('Flow project name differs from the expert; choose its existing project first')
 return root

def collection_rows(flow):
 return flow.js("[...document.querySelectorAll('[data-item-id][data-depth]')].map(e=>({id:e.dataset.itemId,label:e.querySelector('.item-label')?.textContent,depth:Number(e.dataset.depth),directRoot:e.parentElement?.parentElement?.hasAttribute('flownestedlistrootdropzone')===true}))")

def require_root_collection(rows,reference):
 matches=[r for r in rows if r['label']==reference]
 if len(matches)!=1:raise RuntimeError('Exact reference collection is missing or duplicated')
 if matches[0]['depth']!=0 or not matches[0]['directRoot']:raise RuntimeError('Reference collection is nested; move it directly to the expert project root before production')
 return matches[0]

def close_project_editor(flow,root):
 path=flow.js('location.pathname')
 if '/edit/' not in path:return
 if not path.startswith(urlparse(root).path+'/'):raise RuntimeError('Editor belongs to a different project; preserve it')
 names={n.get('name',{}).get('value') for n in flow.ax() if not n.get('ignored')}
 name=next((n for n in ('Done editing scene','Done editing') if n in names),None)
 if not name:raise RuntimeError('Editor close control missing; preserve current scene')
 flow.click('button',name)
 deadline=time.monotonic()+5
 while '/edit/' in flow.js('location.pathname'):
  if time.monotonic()>deadline:raise RuntimeError('Editor did not close; no navigation or generation attempted')
  time.sleep(.1)

def select_project_root(flow,root):
 close_project_editor(flow,root)
 # The Library link is the visible root drop/navigation surface, regardless of current collection.
 if flow.js('location.pathname').rstrip('/')==urlparse(root).path:return
 flow.js("(()=>{const e=document.querySelector('[flow-library-drop-zone]');if(!e)throw Error('Project Library link missing');e.click();return true})()")
 deadline=time.monotonic()+8
 while flow.js('location.pathname').rstrip('/')!=urlparse(root).path:
  if time.monotonic()>deadline:raise RuntimeError('Expert project root navigation not confirmed; no collection created')
  time.sleep(.1)

def select_expert_project(flow,expert,project):
 if not re.fullmatch(r'https://flow\.google\.com/project/[A-Za-z0-9-]+',project):raise ValueError('Use the registered expert project root URL')
 page=flow.js('({url:location.href,title:document.title})')
 current=re.match(r'^/project/([^/]+)',urlparse(page['url']).path)
 if current and 'https://flow.google.com/project/'+current[1]==project:
  # Janela recém-aberta já está na URL certa, mas o título do projeto chega depois.
  deadline=time.monotonic()+12
  while True:
   try:return verify_expert(flow.js('({url:location.href,title:document.title})'),expert,project)
   except (ValueError,RuntimeError):
    if time.monotonic()>=deadline:raise
    time.sleep(.2)
 draft=flow.js("[...document.querySelectorAll('[contenteditable=true]')].some(e=>e.innerText.trim())")
 if draft:
  from flow_drafts import clear_completed_draft
  if not clear_completed_draft(flow):raise RuntimeError('Another expert project has an active draft; preserve that task before switching projects')
 flow.js('location.href='+json.dumps(project+'?hl=en')+';true')
 deadline=time.monotonic()+12
 while time.monotonic()<deadline:
  try:
   current=flow.js('({url:location.href,title:document.title})')
   return verify_expert(current,expert,project)
  except (ValueError,RuntimeError):time.sleep(.1)
 raise RuntimeError('Registered expert project did not confirm its exact identity; no collection was created')

def wait_library_rows(flow,timeout=12,settle=1.2):
 deadline=time.monotonic()+timeout;last=None;stable_since=None
 while time.monotonic()<deadline:
  count=len(collection_rows(flow))
  if count!=last:last,stable_since=count,time.monotonic()
  elif count and time.monotonic()-stable_since>=settle:return count
  time.sleep(.2)
 if not flow.js("!!document.querySelector('[flow-library-drop-zone]')"):raise RuntimeError('Project Library did not render; no collection created')
 return last or 0

def ensure_collection(flow,expert,reference,project=None):
 if not re.fullmatch(r'REF-\d{4}-\d{2}-\d{4}',reference):raise ValueError('Use the exact canonical REF ID')
 if project:select_expert_project(flow,expert,project.rstrip('/'))
 if hasattr(flow,'ensure_ui_language'):flow.ensure_ui_language()
 # Janela recém-aberta ainda não tem o nome do projeto no título.
 deadline=time.monotonic()+12
 while True:
  try:root=verify_expert(flow.js('({url:location.href,title:document.title})'),expert,project);break
  except (ValueError,RuntimeError):
   if time.monotonic()>=deadline:raise
   time.sleep(.2)
 # Escape closes pickers without submitting or changing project.
 flow.key('Escape')
 close_project_editor(flow,root)
 controls=lambda:[n for n in flow.ax() if not n.get('ignored')]
 # After a project switch the Library list renders late; deciding "absent" on an empty list duplicated collections.
 wait_library_rows(flow)
 # Reveal descendants before deciding a collection is absent; otherwise a collapsed parent can cause duplicates.
 for _ in range(30):
  expand=next((n.get('name',{}).get('value') for n in controls() if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value','').startswith('Expand REF-')),None)
  if not expand:break
  flow.click('button',expand);time.sleep(.05)
 matches=[n for n in controls() if n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')==reference]
 if len(matches)>1:raise RuntimeError('Duplicate reference collections; reconcile before upload')
 created=not matches
 if created:
  select_project_root(flow,root)
  flow.click('button','Create collection')
  flow.fill(reference,'input[aria-label="Rename item"]')
  flow.click('button','Confirm rename')
 deadline=time.monotonic()+8
 while not any(n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')==reference for n in controls()):
  if time.monotonic()>deadline:raise RuntimeError('Collection rename not confirmed; inspect before retrying')
  time.sleep(.1)
 require_root_collection(collection_rows(flow),reference)
 flow.click('button',reference)
 deadline=time.monotonic()+8
 while True:
  # Com a grade rolada, o cabeçalho da coleção sai da árvore de acessibilidade.
  page=flow.js('(()=>{for(const e of [document.scrollingElement,...document.querySelectorAll("div.page-container")])e?.scrollTo?.({top:0,behavior:"instant"});return {url:location.href,title:document.title}})()')
  headings=[n.get('name',{}).get('value') for n in controls() if n.get('role',{}).get('value')=='heading']
  if reference in headings and '/collection/' in page['url']:break
  if time.monotonic()>deadline:raise RuntimeError('Collection selection not confirmed')
  time.sleep(.1)
 verify_expert(page,expert,root)
 selected=require_root_collection(collection_rows(flow),reference)
 return {'expert':expert,'reference':reference,'project':root,'collectionUrl':page['url'].split('?')[0],'created':created,'depth':selected['depth'],'directRoot':True}

def collection_media(flow):
 return flow.js('[...document.querySelectorAll(\'flow-project-page img[data-media-id],flow-project-page video[data-media-id],flow-video-tile video[aria-label="Generated video"]\')].map(e=>({assetId:e.getAttribute(\'data-media-id\'),kind:e.tagName.toLowerCase(),name:e.closest(\'flow-grid-tile-container\')?.getAttribute(\'aria-label\')||null,needsEditorBinding:!e.getAttribute(\'data-media-id\'),loaded:e.tagName===\'IMG\'?e.complete&&e.naturalWidth>0:e.readyState>0}))')

GRID='div.page-container.cdk-virtual-scrollable'
TILE_ROWS="[...document.querySelectorAll('flow-grid-tile-container')].map(e=>({name:e.getAttribute('aria-label'),assetId:e.querySelector('img[data-media-id]')?.getAttribute('data-media-id')}))"
def reveal_asset(flow,asset_id,pages=200,name=None):
 """The grid is virtualized and may be filtered to Videos (e.g. left by the collector): an existing image can be off-screen.
 Show Images, then scroll the collection grid looking for the exact asset ID. Read-only; never uploads."""
 seen=lambda:any((r.get('assetId')==asset_id if asset_id else r.get('name')==name and r.get('assetId')) for r in flow.js(TILE_ROWS))
 if seen():return True
 # Janela recém-aberta: a grade ainda não carregou e "não achei" seria falso.
 deadline=time.monotonic()+8
 while not flow.js(TILE_ROWS) and time.monotonic()<deadline:time.sleep(.2)
 if seen():return True
 names={n.get('name',{}).get('value') for n in flow.ax() if not n.get('ignored')} if hasattr(flow,'ax') else set()
 if 'Images' in names:flow.click('button','Images');time.sleep(.3)
 flow.js('document.querySelector('+json.dumps(GRID)+')?.scrollTo({top:0,behavior:"instant"})');time.sleep(.3)
 for _ in range(pages):
  if seen():return True
  d=flow.js('(()=>{const e=document.querySelector('+json.dumps(GRID)+');return e?{top:e.scrollTop,height:e.clientHeight,total:e.scrollHeight}:null})()')
  if not isinstance(d,dict) or d['top']+d['height']>=d['total']-2:
   # A grade recarrega depois de clicar em Images: fim da rolagem ainda não prova que a imagem não existe.
   deadline=time.monotonic()+6
   while time.monotonic()<deadline:
    if seen():return True
    time.sleep(.3)
   return seen()
  flow.js('document.querySelector('+json.dumps(GRID)+').scrollTo({top:'+str(d['top']+d['height']*.75)+',behavior:"instant"})');time.sleep(.3)
 return seen()
def bind_collection_image(flow,name,asset_id=None):
 reveal_asset(flow,asset_id,name=name)
 rows=list({(r.get('assetId'),r.get('name')):r for r in flow.js(TILE_ROWS)}.values())
 # A recorded asset ID is the identity; names may repeat for identical uploads.
 matches=[r for r in rows if r.get('assetId')==asset_id] if asset_id else [r for r in rows if r.get('name')==name and r.get('assetId')]
 if len(matches)!=1:raise ValueError('Exact planned image is missing or ambiguous in this reference collection: '+name)
 return {'pickerName':matches[0]['name'],'assetId':matches[0]['assetId']}

def drop_images(flow,paths):
 from flow_control import validate_images
 paths=validate_images(paths)
 if '/collection/' not in flow.js('location.pathname'):raise ValueError('Select the exact reference collection before uploading')
 if not flow.js("!!document.querySelector('flow-project-page')"):raise RuntimeError('Flow project page is not ready')
 # Public file-drop surface; chunks keep the existing Harness IPC under its size limit.
 flow.js('window.__flowUploadFiles=new DataTransfer();true')
 try:
  for raw in paths:
   path=Path(raw);data=base64.b64encode(path.read_bytes()).decode()
   flow.js("window.__flowUploadBytes='';true")
   for offset in range(0,len(data),48000):flow.js('window.__flowUploadBytes+='+json.dumps(data[offset:offset+48000])+';true')
   mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[path.suffix.lower()]
   flow.js("(()=>{const b=Uint8Array.from(atob(window.__flowUploadBytes),c=>c.charCodeAt(0));window.__flowUploadFiles.items.add(new File([b],"+json.dumps(path.name)+",{type:"+json.dumps(mime)+"}));delete window.__flowUploadBytes;return true})()")
  return flow.js("(()=>{const d=window.__flowUploadFiles;const e=document.querySelector('flow-project-page');for(const type of ['dragenter','dragover','drop'])e.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:d}));return {assignedFiles:[...d.files].map(f=>f.name),submittedGeneration:false}})()")
 finally:flow.js('delete window.__flowUploadBytes;delete window.__flowUploadFiles;true')
