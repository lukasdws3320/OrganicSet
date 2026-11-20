"""Fixed Flow UI operations over the already-running Browser Harness IPC. No eval/exec/CDP-connect command."""
import argparse,base64,json,os,re,subprocess,sys,time,hashlib,urllib.request
from pathlib import Path
from urllib.parse import urlparse,parse_qsl,urlencode,urlunparse

SUBMIT=re.compile(r"generate|generation|gerar|criar (?:imagem|v[ií]deo)|send message|submit|arrow_forward|animate|send prompt|^(?:send|run|create|go|arrow_upward|play_arrow)$",re.I)
ROLES={"button","menuitem","tab","radio","option","checkbox","combobox"}
KEYS={"Escape":(27,"Escape"),"Tab":(9,"Tab"),"Backspace":(8,"Backspace"),"ArrowLeft":(37,"ArrowLeft"),"ArrowUp":(38,"ArrowUp"),"ArrowRight":(39,"ArrowRight"),"ArrowDown":(40,"ArrowDown"),"Enter":(13,"Enter")}

def validate_images(paths):
 if not 1<=len(paths)<=30:raise ValueError("Provide 1 to 30 existing image paths.")
 result=[]
 for raw in paths:
  path=Path(raw)
  if not path.is_absolute() or not path.is_file() or path.suffix.lower() not in {".png",".jpg",".jpeg",".webp",".gif"}:raise ValueError("Each image must be an existing absolute PNG/JPG/WebP/GIF file.")
  if path.stat().st_size>80*1024*1024:raise ValueError("Image exceeds 80 MB.")
  head=path.read_bytes()[:16]
  if not (head.startswith(b"\x89PNG\r\n\x1a\n") or head.startswith(b"\xff\xd8\xff") or head.startswith((b"GIF87a",b"GIF89a")) or (head.startswith(b"RIFF") and head[8:12]==b"WEBP")):raise ValueError("File does not have a recognized image signature.")
  result.append(str(path.resolve()))
 return result

def validate_download_url(url):
 parsed=urlparse(url)
 if parsed.scheme!="https" or not parsed.hostname or not (parsed.hostname=="flow-content.google" or parsed.hostname.endswith(".flow-content.google")) or parsed.username or parsed.password or parsed.port not in {None,443} or not parsed.path.startswith("/"):
  raise ValueError("Only an observed HTTPS flow-content.google media URL is allowed.")
 return url

class MediaRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  validate_download_url(newurl)
  return super().redirect_request(req,fp,code,msg,headers,newurl)

def validate_click(role,name,allow_submit=False):
 if role not in ROLES or not name or len(name)>500:raise ValueError("Use an exact accessible role and name from status.")
 if SUBMIT.search(name) and not allow_submit:raise ValueError("Generation/submit is blocked; explicit supervised --allow-submit is required.")

def build_parser():
 parser=argparse.ArgumentParser(description="Flow control through existing Browser Harness only; never opens a browser connection.")
 sub=parser.add_subparsers(dest="command",required=True)
 status=sub.add_parser("status");status.add_argument("--body-limit",type=int,default=3500);status.add_argument("--ax-limit",type=int,default=100)
 click=sub.add_parser("click");click.add_argument("--role",required=True);click.add_argument("--name",required=True);click.add_argument("--allow-submit",action="store_true")
 upload=sub.add_parser("upload");upload.add_argument("paths",nargs="+");upload.add_argument("--selector",default='input[type="file"]')
 fill=sub.add_parser("fill");source=fill.add_mutually_exclusive_group(required=True);source.add_argument("--text");source.add_argument("--prompt-file");fill.add_argument("--selector",default='[contenteditable="true"]')
 key=sub.add_parser("key");key.add_argument("key",choices=KEYS);key.add_argument("--allow-submit",action="store_true")
 shot=sub.add_parser("screenshot");shot.add_argument("--output",required=True)
 sub.add_parser("media-list")
 sub.add_parser("composer-snapshot")
 sub.add_parser("settings-snapshot")
 collection=sub.add_parser('ensure-collection');collection.add_argument('--expert',required=True);collection.add_argument('--reference',required=True);collection.add_argument('--project')
 dropped=sub.add_parser('collection-upload');dropped.add_argument('paths',nargs='+');dropped.add_argument('--expert',required=True);dropped.add_argument('--reference',required=True);dropped.add_argument('--project')
 sub.add_parser('collection-media')
 tab=sub.add_parser('ensure-tab',help='Aba própria desta REF+personagem, reaproveitada enquanto existir');tab.add_argument('--key',required=True);tab.add_argument('--project',required=True)
 images=sub.add_parser('upload-images',help='Sobe de uma vez, na coleção da REF, as imagens que faltam');images.add_argument('paths',nargs='+');images.add_argument('--expert',required=True);images.add_argument('--reference',required=True);images.add_argument('--project',required=True);images.add_argument('--slug',required=True);images.add_argument('--root',required=True)
 execute=sub.add_parser('execute-plan');execute.add_argument('--plan',required=True);execute.add_argument('--shot-number',type=int);execute.add_argument('--submit',action='store_true')
 batch=sub.add_parser('run-batch',help='Audit offline; --submit queues authorized generation, optionally on isolated tabs');batch.add_argument('--manifest',required=True);batch.add_argument('--submit',action='store_true');batch.add_argument('--limit',type=int);batch.add_argument('--workers',type=int,choices=range(1,10),default=1);batch.add_argument('--targets')
 vtabs=sub.add_parser('verify-batch-tabs',help='Read-only: report which bound tabs are alive Flow pages in this profile');vtabs.add_argument('--targets',required=True)
 tabs=sub.add_parser('prepare-batch-tabs',help='Bind isolated Flow tabs in the existing account, without generation');tabs.add_argument('--manifest',required=True);tabs.add_argument('--output',required=True)
 create=sub.add_parser('create-batch',help='Pin and validate expert plans in a new offline batch manifest');create.add_argument('--output',required=True);create.add_argument('--max-credits',type=float,required=True);create.add_argument('plans',nargs='+')
 progress=sub.add_parser('plan-status',help='Compact offline per-shot progress, without prompts or browser access');progress.add_argument('--plan',required=True);progress.add_argument('--idle-seconds',type=float,default=300)
 batch_progress=sub.add_parser('batch-status',help='One compact offline snapshot for every job');batch_progress.add_argument('--manifest',required=True);batch_progress.add_argument('--idle-seconds',type=float,default=300);batch_progress.add_argument('--detailed',action='store_true')
 reg=sub.add_parser('register-asset',help='Adopt one existing collection image by exact asset ID; offline, never uploads');reg.add_argument('--project',required=True);reg.add_argument('--reference',required=True);reg.add_argument('--file',required=True);reg.add_argument('--asset-id',required=True);reg.add_argument('--picker-name',required=True)
 sh=sub.add_parser('register-shared-asset',help='Allowlist one existing upload for several REFs of one expert; offline, never uploads');sh.add_argument('--project',required=True);sh.add_argument('--file',required=True);sh.add_argument('--asset-id',required=True);sh.add_argument('--picker-name',required=True);sh.add_argument('--expert-slug',required=True);sh.add_argument('--contact-sheet-sha256',required=True);sh.add_argument('--references',required=True,help='JSON list or comma-separated')
 collect=sub.add_parser('collect-plan',help='Bounded collection only; never generates or retries paid work');collect.add_argument('--plan',required=True);collect.add_argument('--idle-seconds',type=float,default=300);collect.add_argument('--max-seconds',type=float,default=900);collect.add_argument('--poll-seconds',type=float,default=15)
 collect_batch=sub.add_parser('collect-batch',help='Round-robin bounded collection across isolated job tabs');collect_batch.add_argument('--manifest',required=True);collect_batch.add_argument('--targets',required=True);collect_batch.add_argument('--idle-seconds',type=float,default=300);collect_batch.add_argument('--max-seconds',type=float,default=900);collect_batch.add_argument('--poll-seconds',type=float,default=15)
 delivery=sub.add_parser('audit-delivery',help='Check final clip hashes and per-version review evidence offline');delivery.add_argument('--manifest',required=True)
 build_delivery=sub.add_parser('build-delivery',help='Create a new delivery version without overwriting prior manifests');build_delivery.add_argument('--selection',required=True);build_delivery.add_argument('--output',required=True)
 for command in ["click-media","hover-media"]:
  media=sub.add_parser(command);media.add_argument("--index",type=int,required=True);media.add_argument("--expect-src")
 download=sub.add_parser("download-media");download.add_argument("--index",type=int,required=True);download.add_argument("--output",required=True);download.add_argument("--expect-src")
 imported=sub.add_parser("import-images");imported.add_argument("paths",nargs="+");imported.add_argument("--selector",default='input[type="file"]');imported.add_argument("--no-dedupe",action="store_true");imported.add_argument("--wait-seconds",type=int,default=20)
 run=sub.add_parser("run-plan");run.add_argument("--plan",required=True);run.add_argument("--phase",choices=["prepare","status","inputs","image","video","submit","record","recover"],default="prepare");run.add_argument("--kind",choices=["still","shot"],default="still");run.add_argument("--item");run.add_argument("--file");run.add_argument("--asset-id");run.add_argument("--picker-name");run.add_argument("--project");run.add_argument("--quote",type=int);run.add_argument("--submit-name");run.add_argument("--acknowledge-spend",action="store_true");run.add_argument("--approved",action="store_true")
 run.add_argument('--check-only',action='store_true')
 return parser

def _conexao():
 try:return json.loads(Path(os.environ.get('FLOW_MCP_CONFIG',str(Path.home()/'.config/google-flow-mcp/connection.json'))).read_text())
 except Exception:return {}
# Pasta do aluno: conta e perfil do Chrome vêm da configuração feita pela skill `configurar`.
FLOW_ACCOUNT=os.environ.get('FLOW_ACCOUNT') or _conexao().get('accountEmail','')
FLOW_CHROME_PROFILE=os.environ.get('FLOW_CHROME_PROFILE') or _conexao().get('chromeProfile','Default')
ACCOUNT_LABELS="[...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')).filter(a=>/@/.test(a))"
def account_email(labels):
 for label in labels or []:
  match=re.search(r'\(([^()\s]+@[^()\s]+)\)',label or '')
  if match:return match.group(1).lower()
 return None
def flow_pages(h):
 return [t for t in h.cdp('Target.getTargets').get('targetInfos',[]) if t.get('type')=='page' and urlparse(t.get('url','')).scheme=='https' and urlparse(t.get('url','')).hostname=='flow.google.com']
def attach_tab(h,target):
 sid=h.cdp('Target.attachToTarget',targetId=target,flatten=True)['sessionId']
 import atexit;atexit.register(lambda:h.cdp('Target.detachFromTarget',sessionId=sid))
 return sid
def tab_account(h,sid,timeout=10,clock=time.monotonic,sleep=time.sleep):
 deadline=clock()+timeout
 while True:
  try:email=account_email(h._runtime_evaluate(ACCOUNT_LABELS,session_id=sid,await_promise=True))
  except RuntimeError:email=None
  if email or clock()>=deadline:return email
  sleep(.25)
def worker_tabs():
 file=tab_bindings_file()
 return set(json.loads(file.read_text()).get('targets',{}).values()) if file.exists() else set()
def tab_bindings_file():return Path(os.environ.get('FLOW_TAB_BINDINGS',str(Path.home()/'.config/google-flow-mcp/state/tabs/bindings.json')))
def save_config(config_file,config):
 tmp=config_file.with_suffix('.tmp');tmp.write_text(json.dumps(config,indent=2)+'\n');tmp.chmod(0o600);tmp.replace(config_file)
def bind_coordinator(h,config_file,opener=None,clock=time.monotonic,sleep=time.sleep,timeout=25):
 """Usa uma aba do Flow na conta certa sem mudar a aba de nenhuma outra tarefa; sem nenhuma, abre outra no perfil Flow."""
 config=json.loads(Path(config_file).read_text());expected=config.get('accountEmail',FLOW_ACCOUNT).lower();configured=config.get('targetId')
 def accept(row,sid):
  config['targetId']=row['targetId'];config['accountEmail']=expected
  if row['targetId']!=configured or 'accountEmail' not in json.loads(Path(config_file).read_text()):save_config(Path(config_file),config)
  return sid,row['targetId']
 workers=worker_tabs();seen={}
 for row in sorted((t for t in flow_pages(h) if t['targetId'] not in workers),key=lambda t:t['targetId']!=configured):
  context=row.get('browserContextId')
  sid=attach_tab(h,row['targetId'])
  if context not in seen:seen[context]=tab_account(h,sid,clock=clock,sleep=sleep)
  if seen[context]==expected:return accept(row,sid)
 before={t['targetId'] for t in h.cdp('Target.getTargets').get('targetInfos',[])}
 from plataforma import abrir_chrome
 (opener or (lambda:abrir_chrome(config.get('chromeProfile',FLOW_CHROME_PROFILE),'https://flow.google.com/?hl=en')))()
 deadline=clock()+timeout
 while clock()<deadline:
  fresh=[t for t in flow_pages(h) if t['targetId'] not in before]
  if fresh:
   sid=attach_tab(h,fresh[0]['targetId']);email=tab_account(h,sid,clock=clock,sleep=sleep)
   if email!=expected:raise RuntimeError(f'O perfil Flow não está na conta {expected} (lida: {email}); nada foi enviado.')
   return accept(fresh[0],sid)
  sleep(.5)
 raise RuntimeError('A aba do Flow não abriu no perfil Flow; nada foi enviado.')

def _chrome_cdp_up(port=9222):
 import urllib.request
 try:urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version',timeout=2).read();return True
 except Exception:return False
def recover_daemon(name,require,cdp_up=_chrome_cdp_up,run=subprocess.run,popen=subprocess.Popen,sleep=time.sleep,profile=FLOW_CHROME_PROFILE):
 """Regra do Matheus (06/11/2026): Chrome fechado ou daemon caído se resolve sozinho, sem pedir e SEMPRE em segundo plano:
 abre o Chrome com `open -g` no perfil Flow, sobe o daemon e aprova o aviso de depuração com mac-approve. Nunca traz janela à frente."""
 try:return require(name)
 except Exception as first:
  from plataforma import WINDOWS,abrir_chrome,aprovar_depuracao
  if not cdp_up():
   if WINDOWS:abrir_chrome(profile,'https://flow.google.com/?hl=en')
   else:run(['open','-g','-na','Google Chrome','--args','--profile-directory='+profile,'https://flow.google.com/?hl=en'],check=True)
   for _ in range(20):
    if cdp_up():break
    sleep(1)
  approve=aprovar_depuracao(popen)
  env={k:v for k,v in os.environ.items() if k!='BH_REQUIRE_EXISTING_DAEMON'};env['BU_NAME']=name
  try:run(['browser-harness'],input='print(page_info())\n',text=True,env=env,capture_output=True,timeout=90)
  finally:
   try:
    if approve:approve.terminate()
   except Exception:pass
  try:return require(name)
  except Exception as exc:raise RuntimeError(f'Daemon {name!r} não voltou após abrir o Chrome em segundo plano e aprovar a depuração ({first}); nada foi enviado.') from exc

class FlowControl:
 def __init__(self):
  os.environ["BH_REQUIRE_EXISTING_DAEMON"]="1"
  # FLOW_BU_NAME/FLOW_LOCK_FILE: uma aba e um daemon por trabalho em execução paralela; padrão = daemon único.
  os.environ["BU_NAME"]=os.environ.get("FLOW_BU_NAME","default")
  from browser_harness import helpers as h
  from browser_harness.admin import require_existing_daemon
  recover_daemon(os.environ["BU_NAME"],require_existing_daemon)
  # O comando do Flow só passa pelos scripts do setup; script solto de agente é recusado, sem tocar na UI.
  entry=sys.argv[0] if sys.argv else ''
  if entry in {'','-','-c'} or Path(entry).resolve().parent!=Path(__file__).resolve().parent:raise RuntimeError("Flow só pode ser comandado por scripts/flow-control ou pela fila do Hub; script avulso recusado.")
  config_file=Path(os.environ.get("FLOW_MCP_CONFIG",str(Path.home()/".config/google-flow-mcp/connection.json")))
  self.h=h;self.sid,self.target=bind_coordinator(h,config_file)
  # Execução paralela: FLOW_TARGET_ID liga esta instância a outra aba do MESMO perfil (conta) da aba configurada,
  # por uma sessão CDP própria no daemon já autorizado. Sem a variável, nada muda.
  extra=os.environ.get("FLOW_TARGET_ID")
  if extra and extra!=self.target:
   infos={t["targetId"]:t for t in h.cdp("Target.getTargets").get("targetInfos",[])}
   if extra not in infos or infos[extra].get("browserContextId")!=infos.get(self.target,{}).get("browserContextId"):raise RuntimeError("Parallel tab is missing or belongs to another Chrome profile/account; refusing it.")
   sid=h.cdp("Target.attachToTarget",targetId=extra,flatten=True)["sessionId"]
   url=urlparse(h._runtime_evaluate("location.href",session_id=sid,await_promise=True) or "")
   if url.scheme!="https" or url.hostname!="flow.google.com":raise RuntimeError("Parallel tab is not on flow.google.com; refusing another page/account.")
   import atexit;atexit.register(lambda:h.cdp("Target.detachFromTarget",sessionId=sid))
   self.sid=sid;self.target=extra
  self.prepare_background_target()
 def prepare_background_target(self):
  # Mantém renderização/foco emulado no target sem selecionar aba ou trazer o Chrome à frente.
  self.cdp('Emulation.setFocusEmulationEnabled',enabled=True)
 def cdp(self,method,**params):return self.h.cdp(method,session_id=self.sid,**params)
 def js(self,expression):return self.h._runtime_evaluate(expression,session_id=self.sid,await_promise=True)
 def ax(self):return self.cdp("Accessibility.getFullAXTree").get("nodes",[])
 def ensure_ui_language(self):
  expression="({url:location.href,language:document.documentElement.lang,hasDraft:[...document.querySelectorAll('[contenteditable=true]')].some(e=>e.innerText.trim())})"
  page=self.js(expression)
  if page.get('language','').lower().startswith('en'):return page
  parsed=urlparse(page['url'])
  if parsed.scheme!='https' or parsed.hostname!='flow.google.com':raise RuntimeError('Locale recovery requires the existing Flow tab')
  if page.get('hasDraft'):raise RuntimeError('Non-English Flow UI contains a draft; preserve it and its reference IDs before reloading the same task')
  query=dict(parse_qsl(parsed.query));query['hl']='en'
  target=urlunparse(parsed._replace(query=urlencode(query)))
  self.js('location.href='+json.dumps(target)+';true')
  deadline=time.monotonic()+12
  while time.monotonic()<deadline:
   try:
    current=self.js(expression)
    if current.get('language','').lower().startswith('en') and urlparse(current['url']).path==parsed.path:return current
   except RuntimeError:pass
   time.sleep(.1)
  raise RuntimeError('The same Flow page did not confirm English controls; no generation was submitted')
 def status(self,body_limit=3500,ax_limit=100):
  body_limit=max(0,min(body_limit,20000));ax_limit=max(0,min(ax_limit,400))
  page=self.js("(()=>({url:location.href,title:document.title,language:document.documentElement.lang,body:document.body.innerText.slice(0,"+str(body_limit)+"),file_inputs:[...document.querySelectorAll('input[type=file]')].map(e=>({accept:e.accept,multiple:e.multiple,files:[...e.files].map(f=>f.name)}))}))()")
  page["controls"]=[{"role":n.get("role",{}).get("value"),"name":n.get("name",{}).get("value","")} for n in self.ax() if not n.get("ignored") and n.get("role",{}).get("value") in ROLES|{"textbox","dialog","heading"}][:ax_limit]
  page["transport"]="existing-harness-ipc"
  return page
 def click(self,role,name,allow_submit=False):
  validate_click(role,name,allow_submit)
  deadline=time.monotonic()+2
  while True:
   nodes=[n for n in self.ax() if not n.get("ignored") and n.get("role",{}).get("value")==role and n.get("name",{}).get("value")==name]
   if nodes or time.monotonic()>=deadline:break
   time.sleep(.05)
  if len(nodes)!=1:raise RuntimeError("Exact control is missing or ambiguous; read status and choose its exact role/name.")
  node=nodes[0].get("backendDOMNodeId")
  if not node:raise RuntimeError("Control has no DOM node.")
  obj=self.cdp('DOM.resolveNode',backendNodeId=node)['object']['objectId']
  try:
   # O botão de gerar só aceita clique real (evento confiável); this.click() não dispara e o prompt fica parado.
   trusted=allow_submit and name=='Start generation'
   result=self.cdp('Runtime.callFunctionOn',objectId=obj,functionDeclaration='function(){if(this.disabled||this.getAttribute("aria-disabled")==="true")throw Error("Control disabled");'+('this.scrollIntoView({block:"center"});const r=this.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}' if trusted else 'this.click();return true')+'}',returnByValue=True,userGesture=True)
   if result.get('exceptionDetails'):raise RuntimeError('Control could not be activated; inspect the current state before retrying')
   if trusted:
    point=result['result']['value']
    for kind in ('mouseMoved','mousePressed','mouseReleased'):self.cdp('Input.dispatchMouseEvent',type=kind,x=point['x'],y=point['y'],button='left' if kind!='mouseMoved' else 'none',clickCount=1 if kind!='mouseMoved' else 0)
  finally:self.cdp('Runtime.releaseObject',objectId=obj)
  return {"clicked":{"role":role,"name":name},"submitted_action":bool(SUBMIT.search(name))}
 def upload(self,paths,selector):
  paths=validate_images(paths)
  if not selector.startswith("input") or len(selector)>300:raise ValueError("Upload selector must identify a file input.")
  doc=self.cdp("DOM.getDocument",depth=-1)
  node=self.cdp("DOM.querySelector",nodeId=doc["root"]["nodeId"],selector=selector).get("nodeId")
  if not node:raise RuntimeError("Image input missing. Open 'Add ingredients to the prompt box' first; do not use the native Upload file chooser.")
  self.cdp("DOM.setFileInputFiles",files=paths,nodeId=node)
  return {"assigned_files":[Path(p).name for p in paths],"count":len(paths),"note":"Assigned to the image input; verify completed cards with status before generating."}
 def image_presence(self,paths):
  present=[]
  for path in paths:
   name=Path(path).name
   self.fill(name,'input[aria-label="Search assets"]')
   time.sleep(.15)
   options=[n for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='option']
   if any((label:=str(n.get('name',{}).get('value',''))).casefold().startswith(name.casefold())
          and not re.search(r'uploading|enviando|carregando',label,re.I)
          and not any(p.get('name')=='busy' and p.get('value',{}).get('value') for p in n.get('properties',[]))
          for n in options):present.append(path)
  return present
 def import_images(self,paths,selector='input[type="file"]',dedupe=True,wait_seconds=20):
  paths=validate_images(paths);wait_seconds=max(0,min(wait_seconds,30))
  visible=[n for n in self.ax() if not n.get("ignored")]
  picker_open=any(n.get("role",{}).get("value")=="option" or n.get("role",{}).get("value")=="button" and n.get("name",{}).get("value")=="Upload media" for n in visible)
  if not picker_open:self.click("button","Add ingredients to the prompt box")
  tabs=[n.get('name',{}).get('value') for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='tab']
  if 'Uploads' in tabs:self.click('tab','Uploads')
  self.js("(()=>{const e=document.querySelector('input[aria-label=\"Search assets\"]');if(e&&e.value){e.value='';e.dispatchEvent(new Event('input',{bubbles:true}))}})()")
  existing=self.image_presence(paths) if dedupe else []
  pending=[path for path in paths if path not in existing]
  if pending:
   doc=self.cdp("DOM.getDocument",depth=-1)
   if not self.cdp("DOM.querySelector",nodeId=doc["root"]["nodeId"],selector=selector).get("nodeId"):
    # A tela atual do Flow não expõe input de arquivo: na coleção da REF sobe tudo de uma vez pelo drop.
    if '/collection/' not in self.js('location.pathname'):raise RuntimeError('Abra a coleção da REF antes de enviar imagens; nada foi enviado.')
    from flow_organization import drop_images
    drop_images(self,pending)
   else:self.upload(pending,selector)
  deadline=time.monotonic()+wait_seconds
  present=self.image_presence(paths)
  while any(path not in present for path in pending) and time.monotonic()<deadline:
   time.sleep(0.4);present=self.image_presence(paths)
  return {"already_present":[Path(path).name for path in existing],"imported":[Path(path).name for path in pending if path in present],"pending":[Path(path).name for path in pending if path not in present],"complete":all(path in present for path in pending),"dedupe":"Visible completed option filename; not a content hash match","attached_to_prompt":False,"note":"Each ingredient option attaches immediately and closes the picker. Reopen Add ingredients for the next ingredient; no Add to prompt button is required."}
 def key(self,key,allow_submit=False):
  if key=="Enter" and not allow_submit:raise ValueError("Enter may submit; explicit supervised --allow-submit is required.")
  vk,code=KEYS[key]
  for kind in ["keyDown","keyUp"]:self.cdp("Input.dispatchKeyEvent",type=kind,key=key,code=code,windowsVirtualKeyCode=vk,modifiers=0)
  return {"key":key}
 def fill(self,text,selector):
  if not text or len(text)>50000:raise ValueError("Prompt must contain 1 to 50000 characters.")
  if not selector or len(selector)>300:raise ValueError("Invalid textbox selector.")
  literal=json.dumps(selector)
  deadline=time.monotonic()+2
  while True:
   focused=self.js("(()=>{const a=[...document.querySelectorAll("+literal+")].filter(e=>e.getClientRects().length);if(a.length!==1)return false;const e=a[0];if(e.tagName==='INPUT')e.click();e.focus();if(e.select)e.select();else{const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r)}return true})()")
   if focused or time.monotonic()>=deadline:break
   time.sleep(.05)
  if not focused:raise RuntimeError("Textbox missing or ambiguous; use its exact selector.")
  self.cdp("Input.insertText",text=text)
  actual=self.js("(()=>{const e=document.querySelector("+literal+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value??e.innerText})()")
  return {"characters":len(text),"text_matches":actual==text,"submitted":False}
 def picker_option(self,name,frames=False):
  if re.search(r'\.(png|jpe?g|webp)$',name,re.I):
   tabs=[n.get('name',{}).get('value') for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='tab']
   if 'Uploads' in tabs:self.click('tab','Uploads')
  self.fill(name,'input[aria-label="Search assets"]')
  deadline=time.monotonic()+12
  while True:
   options=[n.get('name',{}).get('value','') for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='option']
   matches=[label for label in options if label==name or label.startswith(name+' ') or label.startswith(name+'\n')]
   if len(matches)==1 or time.monotonic()>=deadline:break
   time.sleep(.15)
  if len(matches)!=1 and not (len(matches)>1 and len(set(matches))==1 and re.match(r'^REF-[0-9-]+__([0-9a-f]{12}__|[a-z0-9-]+__[0-9a-f]{20}\.)',name)):
   raise RuntimeError('Media option is missing or ambiguous: '+name)
  node=next(n for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='option' and n.get('name',{}).get('value')==matches[0])
  obj=self.cdp('DOM.resolveNode',backendNodeId=node['backendDOMNodeId'])['object']['objectId']
  try:
   self.cdp('Runtime.callFunctionOn',objectId=obj,functionDeclaration='function(){if(this.getAttribute("aria-disabled")==="true")throw Error("Media unavailable");this.click()}',userGesture=True)
  finally:self.cdp('Runtime.releaseObject',objectId=obj)
  deadline=time.monotonic()+2
  while True:
   tree=[n for n in self.ax() if not n.get('ignored')]
   if any(n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')=='Add to prompt' for n in tree):
    self.click('button','Add to prompt');break
   if not any(n.get('role',{}).get('value')=='textbox' and n.get('name',{}).get('value')=='Search assets' for n in tree) or time.monotonic()>=deadline:break
   time.sleep(.05)
  return {'pickerName':name}
 def settings_open(self):
  aberto=lambda:any(not n.get('ignored') and n.get('role',{}).get('value')=='radio' and n.get('name',{}).get('value')=='Image' for n in self.ax())
  if aberto():return
  visivel=lambda:any(not n.get('ignored') and n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')=='Settings trigger' for n in self.ax())
  if not visivel():
   # Flow (09/11/2026): o modo "Agent" vem ligado e esconde o painel manual (Settings trigger). O controlador
   # trabalha só no modo manual, com prompt, modelo e cotação conferidos: desliga o chip Agent (sem gerar nada).
   ok=self.js("(()=>{const b=[...document.querySelectorAll('button.agent-mode-chip')].filter(b=>b.offsetParent!==null&&b.getAttribute('aria-pressed')==='true');if(b.length!==1)return b.length;b[0].click();return true})()")
   if ok is not True:raise RuntimeError('Manual settings hidden and Agent mode chip missing or ambiguous ('+str(ok)+')')
   deadline=time.monotonic()+3
   while not visivel():
    if time.monotonic()>deadline:raise RuntimeError('Agent mode did not turn off; inspect the current state before retrying')
    time.sleep(.1)
  self.click('button','Settings trigger')
 def radio(self,name,prefix=False):
  deadline=time.monotonic()+2
  while True:
   nodes=[n for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='radio' and (n.get('name',{}).get('value')==name or prefix and n.get('name',{}).get('value','').startswith(name+' '))]
   if len(nodes)==1 or time.monotonic()>=deadline:break
   time.sleep(.05)
  if len(nodes)!=1:raise RuntimeError('Setting unavailable or ambiguous: '+name)
  checked=any(p.get('name')=='checked' and str(p.get('value',{}).get('value')).lower()=='true' for p in nodes[0].get('properties',[]))
  if not checked:self.click('radio',nodes[0]['name']['value'])
  return nodes[0]['name']['value']
 def settings_snapshot(self):
  self.settings_open()
  nodes=self.ax();checked=[n.get('name',{}).get('value','') for n in nodes if not n.get('ignored') and n.get('role',{}).get('value')=='radio' and any(p.get('name')=='checked' and str(p.get('value',{}).get('value')).lower()=='true' for p in n.get('properties',[]))]
  deadline=time.monotonic()+3
  while True:
   info=self.js("(()=>({body:document.body.innerText,model:document.querySelector('button[aria-label=\"Select model family\"]')?.innerText||''}))()")
   quotes=re.findall(r'generat(?:ing|ion)[\s\S]{0,35}?use\s*(\d+)\s*credits?',info['body'],re.I)
   if len(set(quotes))==1:break
   if time.monotonic()>=deadline:raise RuntimeError('Cannot verify the displayed Generating will use N credits quote')
   time.sleep(.1)
  resolution=re.search(r'Video\s*·\s*(\d+p)',info['body'])
  result={'checked':checked,'model':info['model'],'quote':int(quotes[0]),'resolution':resolution.group(1) if resolution else None}
  self.key('Escape');return result
 def configure(self,settings,kind,duration=None):
  from flow_plan import model_key
  self.key('Escape');time.sleep(.2)
  self.settings_open();self.radio('Image' if kind=='still' else 'Video')
  if kind=='shot':self.radio(settings.get('videoMode','Frames'))
  self.radio(settings['aspectRatio'])
  wanted=model_key(settings['imageModel'] if kind=='still' else settings['videoModel'])
  current=self.js("document.querySelector('button[aria-label=\"Select model family\"]')?.innerText||''")
  if model_key(current)!=wanted:
   self.click('button','Select model family')
   deadline=time.monotonic()+2
   while True:
    names=[n.get('name',{}).get('value','') for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='menuitem']
    matches=[name for name in names if model_key(name)==wanted]
    if len(matches)==1 or time.monotonic()>=deadline:break
    time.sleep(.05)
   if len(matches)!=1:raise RuntimeError('Exact requested model is unavailable or ambiguous')
   self.click('menuitem',matches[0])
  if kind=='shot':
   if not wanted.startswith('veo'):self.radio(settings['resolution'],True)
   duracoes=[n.get('name',{}).get('value','') for n in self.ax() if not n.get('ignored') and n.get('role',{}).get('value')=='radio' and re.fullmatch(r'\d+s',n.get('name',{}).get('value',''))]
   # Flow (09/11/2026): com Veo 3.1 o painel não tem mais opção de duração (clipe fixo de 8 s). Só aceita pedido de 8 s.
   if not duracoes and wanted.startswith('veo'):
    if int(duration)!=8:raise RuntimeError('Flow sem seletor de duração para Veo (clipe fixo de 8 s); o plano pediu '+str(duration)+' s')
   else:self.radio(str(duration)+'s')
  self.radio('x'+str(settings.get('imageCount',1) if kind=='still' else 1));return self.settings_snapshot()
 def attach_voice(self,option):
  self.click('button','Add ingredients to the prompt box')
  self.click('tab','Voices')
  self.click('option',option)
  self.click('button','Add to prompt')
 def fill_with_voice_mention(self,prompt,spec):
  prefix=spec['display']+' '
  if not prompt.startswith(prefix):raise ValueError('Voice mention prefix differs from literal prompt')
  self.fill('@','[contenteditable="true"]')
  deadline=time.monotonic()+4
  while not any(not n.get('ignored') and n.get('role',{}).get('value')=='tab' and n.get('name',{}).get('value')=='Voices' for n in self.ax()) and time.monotonic()<deadline:time.sleep(.1)
  self.click('tab','Voices');self.click('option',spec['option']);self.click('button','Add to prompt')
  self.js("(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r)})()")
  self.cdp('Input.insertText',text=prompt[len(prefix):])
  return {'text_matches':self.composer_snapshot()['prompt']==prompt}
 def composer_snapshot(self):
  return self.js("(()=>{const boxes=[...document.querySelectorAll('[contenteditable=\"true\"]')].filter(e=>e.getClientRects().length);if(boxes.length!==1)throw Error('Prompt editor missing or ambiguous');const references=[...document.querySelectorAll('button,[role=\"button\"]')].filter(b=>/^(Ingredient|Image ingredient|Start|End)$/.test((b.getAttribute('aria-label')||b.innerText||'').trim())).flatMap(b=>[...b.querySelectorAll('img')].map(i=>{const u=new URL(i.currentSrc||i.src,location.href);return {role:(b.getAttribute('aria-label')||b.innerText||'').trim(),media:i.getAttribute('data-media-id')||u.pathname,alt:i.alt||''}}));const voices=[...document.querySelectorAll('button[aria-label=\"Ingredient\"]')].filter(b=>b.querySelector('.voice-icon')).map(b=>({role:'Ingredient',media:'voice_selection',alt:'',disabled:b.classList.contains('disabled')}));references.push(...voices);return {mentions:[...boxes[0].querySelectorAll('[data-mention-id]')].map(e=>({id:e.getAttribute('data-mention-id'),type:e.getAttribute('data-reference-type'),text:e.innerText,invalid:e.classList.contains('mention-chip-invalid')})),invalidMentions:boxes[0].querySelectorAll('.mention-chip-invalid').length,prompt:boxes[0].innerText,references:references.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}})()")

 def media_list(self):
  return self.js("(()=>{const a=[...document.querySelectorAll('img,video')].filter(e=>e.getClientRects().length&&Math.max(e.naturalWidth||e.videoWidth||0,e.getBoundingClientRect().width)>96);return {media:a.map((e,index)=>{const r=e.getBoundingClientRect();return {index,kind:e.tagName.toLowerCase(),src:e.currentSrc||e.src,alt:e.alt||'',title:e.title||'',container_label:e.closest('[aria-label]')?.getAttribute('aria-label')||'',naturalWidth:e.naturalWidth||e.videoWidth||0,naturalHeight:e.naturalHeight||e.videoHeight||0,displayWidth:r.width,displayHeight:r.height}})}})()")
 def media_action(self,index,hover=False,expect_src=None):
  if index<0:raise ValueError("Media index must be zero or greater.")
  value=self.js("(()=>{const a=[...document.querySelectorAll('img,video')].filter(e=>e.getClientRects().length&&Math.max(e.naturalWidth||e.videoWidth||0,e.getBoundingClientRect().width)>96);const e=a["+str(index)+"];if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,src:e.currentSrc||e.src}})()")
  if not value:raise RuntimeError("Media index no longer exists; run media-list again.")
  if expect_src and value["src"]!=expect_src:raise RuntimeError("Media source changed; run media-list again before clicking.")
  if hover:self.cdp("Input.dispatchMouseEvent",type="mouseMoved",x=value["x"],y=value["y"])
  if not hover:
   for kind in ["mousePressed","mouseReleased"]:self.cdp("Input.dispatchMouseEvent",type=kind,x=value["x"],y=value["y"],button="left",clickCount=1)
  return {"index":index,"action":"hover" if hover else "click","src":value["src"]}
 def download_media(self,index,output,expect_src=None):
  media=self.media_list()["media"]
  if index<0 or index>=len(media):raise ValueError("Media index no longer exists; run media-list again.")
  item=media[index];url=item["src"]
  if expect_src and url!=expect_src:raise ValueError("Media source changed; run media-list again.")
  validate_download_url(url)
  path=Path(output)
  if not path.is_absolute() or not path.parent.is_dir() or path.suffix.lower() not in {".png",".jpg",".jpeg",".webp",".mp4",".webm"}:raise ValueError("Use an absolute image/video output path in an existing directory.")
  if path.exists():raise ValueError("Output already exists; choose another filename.")
  size=0;digest=hashlib.sha256();part=path.with_name(path.name+".part")
  if part.exists():raise ValueError("Temporary output already exists; choose another filename.")
  try:
   with urllib.request.build_opener(MediaRedirect()).open(urllib.request.Request(url,headers={"User-Agent":"GoogleFlowMCP-local-media-download"}),timeout=45) as response,part.open("xb") as out:
    kind=response.headers.get_content_type()
    if not kind.startswith(("image/","video/")) and kind!="application/octet-stream":raise ValueError("Response is not image/video media.")
    while True:
     chunk=response.read(1024*1024)
     if not chunk:break
     size+=len(chunk)
     if size>300*1024*1024:raise ValueError("Media exceeds 300 MB download limit.")
     digest.update(chunk);out.write(chunk)
   if not size:raise ValueError("Empty media response.")
   part.rename(path)
  except Exception:
   part.unlink(missing_ok=True);raise
  parsed=urlparse(url)
  return {"path":str(path),"bytes":size,"content_type":kind,"sha256":digest.hexdigest(),"source":parsed._replace(query="",fragment="").geturl(),"note":"Downloaded existing media; no generation or credit charge."}
 def screenshot(self,output):
  path=Path(output)
  if not path.is_absolute() or path.suffix.lower()!=".png" or not path.parent.is_dir():raise ValueError("Use an absolute PNG path in an existing directory.")
  data=self.cdp("Page.captureScreenshot",format="png",captureBeyondViewport=False)
  path.write_bytes(base64.b64decode(data["data"]))
  return {"path":str(path)}

def _main(argv=None):
 try:
  args=build_parser().parse_args(argv)
  if args.command=='batch-status':
   from flow_progress import batch_status
   print(json.dumps(batch_status(args.manifest,idle_seconds=args.idle_seconds,detailed=args.detailed),ensure_ascii=False));return 0
  if args.command=='collect-batch':
   from flow_progress import collect_batch
   print(json.dumps(collect_batch(args.manifest,args.targets,idle_seconds=args.idle_seconds,max_seconds=args.max_seconds,poll_seconds=args.poll_seconds),ensure_ascii=False));return 0
  if args.command=='register-shared-asset':
   from flow_asset_registry import register_shared_asset
   refs=json.loads(args.references) if args.references.strip().startswith('[') else [r.strip() for r in args.references.split(',') if r.strip()]
   print(json.dumps(register_shared_asset(args.project,args.file,args.asset_id,args.picker_name,args.expert_slug,args.contact_sheet_sha256,refs),ensure_ascii=False));return 0
  if args.command=='register-asset':
   from flow_asset_registry import register_existing_asset
   print(json.dumps(register_existing_asset(args.project,args.reference,args.file,args.asset_id,args.picker_name),ensure_ascii=False));return 0
  if args.command in {'plan-status','collect-plan'}:
   from flow_progress import plan_status,collect_plan
   result=plan_status(args.plan,idle_seconds=args.idle_seconds) if args.command=='plan-status' else collect_plan(args.plan,idle_seconds=args.idle_seconds,max_seconds=args.max_seconds,poll_seconds=args.poll_seconds)
   print(json.dumps(result,ensure_ascii=False));return 0
  if args.command in {'audit-delivery','build-delivery'}:
   from flow_delivery import audit_delivery,build_delivery
   result=audit_delivery(args.manifest) if args.command=='audit-delivery' else build_delivery(args.selection,args.output)
   print(json.dumps(result,ensure_ascii=False));return 0
  if args.command=='create-batch':
   from flow_scale import create_batch
   print(json.dumps(create_batch(args.output,args.plans,args.max_credits),ensure_ascii=False));return 0
  if args.command=='run-batch':
   if args.submit and (args.workers>1 or args.targets):
    from flow_parallel import run_parallel_batch
    if not args.targets:raise ValueError('Use prepare-batch-tabs and --targets for parallel submission')
    print(json.dumps(run_parallel_batch(args.manifest,args.targets,args.workers,args.limit),ensure_ascii=False));return 0
   from flow_scale import run_batch
   print(json.dumps(run_batch(args.manifest,args.submit,args.limit),ensure_ascii=False));return 0
  if args.command=='verify-batch-tabs':
   from flow_parallel import live_tab_report
   targets=json.loads(Path(args.targets).read_text()).get('targets',{});report=live_tab_report(targets,FlowControl())
   alive=[j for j,r in report.items() if r['present'] and r['sameContext'] and r['type']=='page' and r['flowPage']]
   print(json.dumps({'alive':len(alive),'total':len(report),'tabs':report},ensure_ascii=False));return 0 if len(alive)==len(report) else 1
  if args.command=='prepare-batch-tabs':
   from flow_parallel import prepare_batch_tabs
   print(json.dumps(prepare_batch_tabs(args.manifest,args.output),ensure_ascii=False));return 0
  if args.command=='execute-plan':
   from flow_workflow import execute_plan
   print(json.dumps(execute_plan(args.plan,args.shot_number,args.submit),ensure_ascii=False));return 0
  if args.command=='upload-images':
   from flow_workflow import upload_initial_images
   print(json.dumps(upload_initial_images(args.paths,args.root,args.reference,args.slug,args.project,args.expert),ensure_ascii=False));return 0
  if args.command=='ensure-tab':
   from flow_parallel import ensure_tab
   print(json.dumps(ensure_tab(args.key,args.project),ensure_ascii=False));return 0
  if args.command=="run-plan":
   from flow_plan import run_plan
   print(json.dumps(run_plan(args),ensure_ascii=False));return 0
  # Validate external inputs before contacting the existing daemon.
  if args.command in {"upload","import-images","collection-upload"}:args.paths=validate_images(args.paths)
  if args.command=="click":validate_click(args.role,args.name,args.allow_submit)
  if args.command=="key" and args.key=="Enter" and not args.allow_submit:raise ValueError("Enter may submit; --allow-submit is required.")
  if args.command=="fill":
   text=args.text if args.text is not None else Path(args.prompt_file).read_text(encoding="utf8")
   if not text or len(text)>50000:raise ValueError("Prompt must contain1to50000characters.")
  flow=FlowControl()
  if args.command=="status":result=flow.status(args.body_limit,args.ax_limit)
  elif args.command in {'ensure-collection','collection-upload'}:
   from flow_organization import ensure_collection,drop_images
   result=ensure_collection(flow,args.expert,args.reference,args.project)
   if args.command=='collection-upload':result['upload']=drop_images(flow,args.paths)
  elif args.command=='collection-media':
   from flow_organization import collection_media
   result=collection_media(flow)
  elif args.command=="click":result=flow.click(args.role,args.name,args.allow_submit)
  elif args.command=="upload":result=flow.upload(args.paths,args.selector)
  elif args.command=="import-images":result=flow.import_images(args.paths,args.selector,not args.no_dedupe,args.wait_seconds)
  elif args.command=="fill":result=flow.fill(text,args.selector)
  elif args.command=="key":result=flow.key(args.key,args.allow_submit)
  elif args.command=="media-list":result=flow.media_list()
  elif args.command=="composer-snapshot":result=flow.composer_snapshot()
  elif args.command=="settings-snapshot":result=flow.settings_snapshot()
  elif args.command in {"click-media","hover-media"}:result=flow.media_action(args.index,args.command=="hover-media",args.expect_src)
  elif args.command=="download-media":result=flow.download_media(args.index,args.output,args.expect_src)
  else:result=flow.screenshot(args.output)
  print(json.dumps(result,ensure_ascii=False));return 0
 except Exception as error:
  print(json.dumps({"error":str(error)},ensure_ascii=False));return 1
def operation_lock_path():
 target=os.environ.get('FLOW_TARGET_ID')
 if target:return Path.home()/'.config/google-flow-mcp/state/tabs'/(hashlib.sha256(target.encode()).hexdigest()+'.lock')
 return Path(os.environ.get('FLOW_LOCK_FILE',str(Path.home()/'.config/google-flow-mcp/state/control-operation.lock')))

def main(argv=None):
 import fcntl
 commands=sys.argv[1:] if argv is None else argv
 # Offline readers need no UI lock; collection probes acquire it for their own transactions.
 if commands and (commands[0] in {'register-asset','register-shared-asset','plan-status','batch-status','collect-plan','collect-batch','audit-delivery','build-delivery','create-batch'} or commands[0]=='run-batch' and '--submit' not in commands):return _main(commands)
 lock=operation_lock_path()
 lock.parent.mkdir(parents=True,exist_ok=True)
 with lock.open('a') as handle:
  try:fcntl.flock(handle,fcntl.LOCK_EX if commands and commands[0]=='ensure-tab' else fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:
   print(json.dumps({"error":"Another Flow control operation is active; wait for it to finish. No action was retried."}));return 1
  try:return _main(argv)
  finally:fcntl.flock(handle,fcntl.LOCK_UN)
if __name__=="__main__":sys.exit(main())
