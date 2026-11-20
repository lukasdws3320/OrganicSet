"""Imagens já presentes numa coleção Flow, indexadas pelo sha256 do conteúdo (projeto+REF).
O nome remoto não é identidade: bytes iguais reutilizam o mesmo assetId; bytes diferentes nunca se fundem."""
import fcntl,hashlib,json,os,time
from pathlib import Path

def registry_path(project,reference):
 base=Path(os.environ.get('FLOW_ASSET_REGISTRY_DIR',str(Path.home()/'.config/google-flow-mcp/state/collection-assets')))
 key=project.split('?')[0].rstrip('/')+'|'+reference
 return base/(hashlib.sha256(key.encode()).hexdigest()+'.json')

def _update(project,reference,change):
 path=registry_path(project,reference);path.parent.mkdir(parents=True,exist_ok=True)
 with (path.parent/(path.name+'.lock')).open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  data=json.loads(path.read_text()) if path.exists() else {'schema':'flow-collection-assets/v1','project':project,'reference':reference,'assets':{}}
  result=change(data['assets'])
  tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=1));tmp.replace(path)
  return result

def lookup(project,reference,digest):
 path=registry_path(project,reference)
 return json.loads(path.read_text())['assets'].get(digest) if path.exists() else None

def record(project,reference,digest,**fields):
 def change(assets):
  prior=assets.get(digest,{})
  if prior.get('assetId') and fields.get('assetId') and prior['assetId']!=fields['assetId']:raise ValueError('Image content already bound to another collection asset; keep one remote asset per content')
  assets[digest]={**prior,**fields,'sha256':digest,'time':time.time()};return assets[digest]
 return _update(project,reference,change)

def reserve_upload(project,reference,digest,**fields):
 """Atomic: only one process may hold the upload of a given content. Returns (state, entry)."""
 def change(assets):
  prior=assets.get(digest)
  if prior and prior.get('assetId'):return ('available',prior)
  if prior and prior.get('status')=='upload_intent':return ('intent',prior)
  assets[digest]={**(prior or {}),**fields,'sha256':digest,'status':'upload_intent','time':time.time()};return ('reserved',assets[digest])
 return _update(project,reference,change)

def wait_available(project,reference,digest,timeout=90,poll=.5):
 """Another process holds the upload: wait for its confirmed asset instead of uploading again."""
 deadline=time.monotonic()+timeout
 while True:
  entry=lookup(project,reference,digest)
  if entry and entry.get('assetId'):return entry
  if time.monotonic()>=deadline:return None
  time.sleep(poll)

def register_existing_asset(project,reference,file,asset_id,picker_name):
 """Adota um upload já existente, sem novo upload. Prova: o nome remoto carrega o prefixo do hash do arquivo local."""
 from flow_plan import sha
 digest=sha(file)
 if reference not in picker_name or digest[:20] not in picker_name:raise ValueError('Remote name does not carry this file hash prefix; content not proven')
 if not asset_id:raise ValueError('Exact asset ID is required')
 return record(project,reference,digest,assetId=asset_id,pickerName=picker_name,status='available',adopted=True)

def shared_path(project):
 base=Path(os.environ.get('FLOW_ASSET_REGISTRY_DIR',str(Path.home()/'.config/google-flow-mcp/state/collection-assets')))
 return base.parent/'shared-assets'/(hashlib.sha256(project.split('?')[0].rstrip('/').encode()).hexdigest()+'.json')

def register_shared_asset(project,file,asset_id,picker_name,expert_slug,contact_sheet_sha256,references):
 """Explicit project allowlist: one existing upload reused by declared REFs only. Offline, never uploads."""
 from flow_plan import sha
 digest=sha(file);references=sorted(set(references))
 if not asset_id or not expert_slug or not contact_sheet_sha256 or not references:raise ValueError('Asset ID, expert slug, contact sheet sha256 and references are required')
 if digest[:20] not in picker_name:raise ValueError('Remote name does not carry this file hash prefix; content not proven')
 path=shared_path(project);path.parent.mkdir(parents=True,exist_ok=True)
 with (path.parent/(path.name+'.lock')).open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  data=json.loads(path.read_text()) if path.exists() else {'schema':'flow-shared-assets/v1','project':project,'assets':{}}
  for other,e in data['assets'].items():
   if e['assetId']==asset_id and other!=digest:raise ValueError('Asset ID already shared for different image content')
  prior=data['assets'].get(digest)
  if prior and (prior['assetId']!=asset_id or prior['expertSlug']!=expert_slug or prior['contactSheetSha256']!=contact_sheet_sha256):raise ValueError('Image content already shared with another asset/identity')
  entry={'sha256':digest,'assetId':asset_id,'pickerName':picker_name,'expertSlug':expert_slug,'contactSheetSha256':contact_sheet_sha256,'references':sorted(set(references)|set((prior or {}).get('references',[]))),'project':project,'time':time.time()}
  data['assets'][digest]=entry
  tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,ensure_ascii=False,indent=1));tmp.replace(path)
 return entry

def shared_lookup(project,reference,digest,identity):
 """None when this content is not shared; raises when shared but the REF/identity is not allowed."""
 path=shared_path(project)
 entry=json.loads(path.read_text())['assets'].get(digest) if path.exists() else None
 if not entry:return None
 if reference not in entry['references']:raise ValueError('Shared asset is not allowlisted for this reference; no upload')
 if not identity or identity.get('expertSlug')!=entry['expertSlug'] or identity.get('contactSheetSha256')!=entry['contactSheetSha256']:raise ValueError('Shared asset belongs to another expert/contact sheet; no upload')
 return entry
