"""Serial multi-character submissions, with full offline audit before touching Flow.

This queues generation only. Submitted is not downloaded, reviewed or approved.
Run through flow-control so the existing global UI lock covers the whole batch.
"""
import json,math,time
from pathlib import Path
from flow_plan import load_plan,sha,write_json
from flow_identity import validate_contract,fingerprint

def audit_batch(manifest_file):
 file=Path(manifest_file).resolve();manifest=json.loads(file.read_text())
 return audit_manifest(manifest,file,sha(file))

def create_batch(output,plans,max_credits):
 file=Path(output).resolve()
 if file.exists():raise FileExistsError('Preserve the existing batch manifest and journal; choose a new filename')
 manifest={'schema':'flow-production-batch/v1','maxCredits':max_credits,'jobs':[{'plan':str(Path(p).resolve()),'sha256':sha(p)} for p in plans]}
 audit_manifest(manifest,file,fingerprint(manifest))
 with file.open('x') as target:target.write(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 return audit_batch(file)

def audit_manifest(manifest,file,manifest_digest):
 budget=manifest.get('maxCredits')
 if manifest.get('schema')!='flow-production-batch/v1' or not manifest.get('jobs'):raise ValueError('Expected a nonempty flow-production-batch/v1 manifest')
 if isinstance(budget,bool) or not isinstance(budget,(int,float)) or not math.isfinite(budget) or budget<0:raise ValueError('Batch budget must be finite and nonnegative')
 seen=set();keys=set();outputs=[];projects={};owners={};items=[];reserved=0
 for job in manifest['jobs']:
  path=Path(job['plan'])
  if not path.is_absolute():raise ValueError('Batch plan paths must be absolute')
  path=path.resolve()
  if path in seen:raise ValueError('Duplicate batch plan')
  seen.add(path)
  plan,digest=load_plan(path)
  if digest!=job.get('sha256'):raise ValueError('Batch plan changed; reconcile its pinned hash')
  contract=validate_contract(plan,strict=True)
  if contract['jobKey'] in keys:raise ValueError('Duplicate expert/avatar/reference/version in batch')
  keys.add(contract['jobKey'])
  output=Path(plan['outputDir']).resolve()
  if any(output==p or output.is_relative_to(p) or p.is_relative_to(output) for p in outputs):raise ValueError('Batch output directories overlap across production jobs')
  outputs.append(output)
  owner=(contract['expertSlug'],contract['avatarName']);project=contract['projectUrl']
  if project in projects and projects[project]!=owner:raise ValueError('Flow project is shared by different characters')
  if owner in owners and owners[owner]!=project:raise ValueError('Character resolves to conflicting Flow projects')
  projects[project]=owner;owners[owner]=project
  state_file=output/'flow-run.json';state=json.loads(state_file.read_text()) if state_file.exists() else {}
  if state and state.get('planSha256')!=digest:raise ValueError('Production state belongs to a different plan')
  if state.get('project') and state['project']!=project:raise ValueError('Production state project differs from the pinned character project')
  reserved+=plan['settings']['maxCredits']
  items.append({**contract,'plan':str(path),'planSha256':digest,'shots':len(plan['shots']),'maxCredits':plan['settings']['maxCredits'],'outputDir':str(output),'shotStates':{s['id']:state.get('items',{}).get(s['id'],{}).get('status','pending') for s in plan['shots']}})
 if reserved>budget:raise ValueError('Sum of plan budget ceilings exceeds the authorized batch budget')
 return {'schema':'flow-batch-audit/v1','manifest':str(file),'manifestSha256':manifest_digest,'jobs':len(items),'shots':sum(i['shots'] for i in items),'maxReservedCredits':reserved,'maxCredits':budget,'items':items,'uiTouched':False,'generationSubmitted':False}

def run_batch(manifest_file,submit=False,limit=None):
 report=audit_batch(manifest_file)
 if not submit:return {**report,'status':'validated','note':'Offline audit only. No UI preparation or generation.'}
 if limit is not None and (isinstance(limit,bool) or not isinstance(limit,int) or limit<1):raise ValueError('Batch limit must be a positive integer')
 from flow_workflow import execute_plan,PROTECTED
 file=Path(report['manifest']);state_file=file.with_name(file.name+'.state.json')
 state=json.loads(state_file.read_text()) if state_file.exists() else {'schema':'flow-batch-run/v1','manifestSha256':report['manifestSha256'],'items':{}}
 if state.get('manifestSha256')!=report['manifestSha256']:raise ValueError('Batch manifest changed; preserve the current journal and create a new batch')
 attempts=0
 def result(status,**extra):return {'status':status,'state':str(state_file),'attempted':attempts,'uiTouched':attempts>0,'generationSubmitted':any(r.get('status')=='submitted' for r in state['items'].values()),'qualityApproved':False,**extra}
 for job in report['items']:
  for number,(shot_id,status) in enumerate(job['shotStates'].items(),1):
   key=job['jobKey']+':'+shot_id;prior=state['items'].get(key,{})
   if status in {'submitted','available'}:
    if prior.get('status') in {'execution_intent','needs_recovery'}:
     state['items'][key].update(status=status,reconciledFromProductionState=True);write_json(state_file,state)
    continue
   # Unknown journal intent survives process termination; no free pass to resubmit.
   if prior.get('status') in {'execution_intent','needs_recovery'}:return result('needs_recovery',item=key)
   if prior.get('status') in {'submitted','available'}:continue
   if status in PROTECTED:return result('needs_recovery',item=key,productionStatus=status)
   if limit is not None and attempts>=limit:return result('limited')
   # Revalidate before each transaction, protecting changes after the full batch audit.
   if sha(file)!=report['manifestSha256'] or sha(job['plan'])!=job['planSha256']:raise ValueError('Batch or plan changed during execution')
   state['items'][key]={'status':'execution_intent','plan':job['plan'],'planSha256':job['planSha256'],'number':number,'shot':shot_id,'time':time.time(),'voiceTimbreVerified':False}
   write_json(state_file,state);attempts+=1
   try:
    receipt=execute_plan(job['plan'],number,True)
    received=receipt.get('status')
    state['items'][key].update(status=received if received in {'submitted','available'} else 'needs_recovery',receipt=receipt)
    write_json(state_file,state)
    if received not in {'submitted','available'}:return result('needs_recovery',item=key)
   except Exception as error:
    state['items'][key].update(status='needs_recovery',errorType=type(error).__name__)
    write_json(state_file,state)
    return result('needs_recovery',item=key,errorType=type(error).__name__)
 return result('submitted',note='Submission queue completed; download and audio/identity review remain separate stages.')
