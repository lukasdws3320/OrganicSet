"""Preserve unrelated drafts; clear only a completed, exact transaction-owned draft."""
import hashlib,json,os,re,time
from pathlib import Path
from flow_plan import load_plan,sha,write_json

def marker(flow):
 target=getattr(flow,'target',None)
 if not isinstance(target,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',target):return None
 return Path(os.environ.get('FLOW_DRAFT_DIR',str(Path.home()/'.config/google-flow-mcp/state/drafts')))/(target+'.json')
def register_draft(flow,plan_file,shot):
 path=marker(flow)
 if path is None:return
 path.parent.mkdir(parents=True,exist_ok=True)
 write_json(path,{'plan':str(Path(plan_file).resolve()),'planSha256':sha(plan_file),'shot':shot,'registeredAt':time.time()})
def clear_completed_draft(flow):
 path=marker(flow)
 if path is None or not path.is_file():return False
 record=json.loads(path.read_text());plan,digest=load_plan(record['plan'])
 if digest!=record['planSha256']:return False
 state_path=Path(plan['outputDir'])/'flow-run.json'
 if not state_path.is_file():return False
 item=json.loads(state_path.read_text()).get('items',{}).get(record['shot'],{})
 if item.get('status') not in ('submitted','available'):return False
 shot=next((s for s in plan['shots'] if s['id']==record['shot']),None)
 snapshot=flow.composer_snapshot()
 if not shot or snapshot['prompt']!=shot['prompt'] or snapshot['references']!=item.get('referenceSnapshot'):return False
 # A whitespace-only composer is empty to Flow; the normal editor input path updates app state.
 flow.fill(' ','[contenteditable=true][role="textbox"]')
 if flow.composer_snapshot()['prompt'].strip():raise RuntimeError('Owned draft did not clear')
 write_json(path,{**record,'clearedAt':time.time(),'promptSha256':hashlib.sha256(shot['prompt'].encode()).hexdigest()})
 return True
