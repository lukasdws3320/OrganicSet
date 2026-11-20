"""Compact local progress and bounded collection; never submits or retries generation."""
import json,math,os,re,subprocess,sys,time
from pathlib import Path
from flow_plan import load_plan,sha

def positive(value,label):
 if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0:raise ValueError(label+' must be finite and positive')

def plan_status(plan_file,now=None,idle_seconds=300):
 positive(idle_seconds,'Idle threshold');now=time.time() if now is None else now
 plan,digest=load_plan(plan_file);root=Path(plan['outputDir']);state_file=root/'flow-run.json'
 state=json.loads(state_file.read_text()) if state_file.exists() else {}
 if state and state.get('planSha256')!=digest:raise ValueError('Production state belongs to a different plan')
 rows=[];counts={}
 for shot in plan['shots']:
  sid=shot['id'];item=state.get('items',{}).get(sid,{});status=item.get('status','pending')
  events=[e['time'] for e in state.get('events',[]) if e.get('item')==sid and e.get('phase') in {'submitted','submission_intent','submission_uncertain','submission_not_acknowledged'} and isinstance(e.get('time'),(int,float)) and math.isfinite(e['time'])]
  age=max(0,now-max(events)) if events else None
  path=Path(item.get('file') or root/(sid+'.shot.mp4'))
  available=status=='available' and path.is_file() and bool(item.get('sha256')) and sha(path)==item['sha256']
  action='review' if available else 'recover_existing' if status in {'uncertain','submission_intent','failed','blocked','available'} else 'poll' if status=='submitted' and age is not None and age<idle_seconds else 'recover_existing' if status=='submitted' else 'prepare'
  counts[action]=counts.get(action,0)+1
  rows.append({'shot':sid,'state':status,'ageSeconds':round(age,1) if age is not None else None,'nextAction':action})
 return {'schema':'flow-progress/v1','ref':plan['ref'],'expertSlug':plan.get('identity',{}).get('expertSlug'),
         'plan':str(Path(plan_file).resolve()),'counts':counts,'items':rows,'uiTouched':False,'generationSubmitted':False,
         'note':'recover_existing is unresolved evidence, not proof of rejection, cost or a safety-filter cause.'}

def probe_once(plan_file,skip=(),timeout=60,target=None):
 command=[sys.executable,str(Path(__file__).with_name('flow_collect_videos.py')),str(Path(plan_file).resolve()),'--cycles','1']
 for item in skip:command+=['--skip',item]
 env={**os.environ,**({'FLOW_TARGET_ID':target} if target else {})}
 result=subprocess.run(command,capture_output=True,text=True,timeout=timeout,env=env)
 if result.returncode:
  detail=re.sub(r'https?://\S+','[URL omitted]',(result.stdout+'\n'+result.stderr))[-1800:]
  plan,_=load_plan(plan_file);(Path(plan['outputDir'])/'collection-probe-error.log').write_text(detail)
  raise RuntimeError('Collection probe failed: '+detail[-500:])

def collect_plan(plan_file,idle_seconds=300,max_seconds=900,poll_seconds=15,*,clock=time.time,sleep=time.sleep,probe=probe_once):
 for value,label in [(idle_seconds,'Idle threshold'),(max_seconds,'Maximum duration'),(poll_seconds,'Poll interval')]:positive(value,label)
 started=clock();probes=0;skip=[]
 while True:
  report=plan_status(plan_file,now=clock(),idle_seconds=idle_seconds)
  active=[r for r in report['items'] if r['state'] in {'submitted','uncertain','submission_intent'}]
  # First probe also recovers already-rendered outputs from an old or uncertain submission.
  if active and clock()-started<max_seconds and (probes==0 or any(r['nextAction']=='poll' for r in active)):
   try:probe(plan_file,skip,max(.1,min(60,max_seconds-(clock()-started))))
   except (RuntimeError,subprocess.TimeoutExpired) as error:
    return {**report,'status':'needs_recovery','probeError':type(error).__name__,'probeMessage':str(error)[:600],'probes':probes+1,'uiTouched':True}
   probes+=1;report=plan_status(plan_file,now=clock(),idle_seconds=idle_seconds)
  waiting=[r for r in report['items'] if r['nextAction']=='poll']
  unresolved=[r['shot'] for r in report['items'] if r['nextAction']=='recover_existing']
  if not waiting or clock()-started>=max_seconds:
   return {**report,'status':'needs_recovery' if unresolved or waiting else 'collected' if report['counts'].get('review')==len(report['items']) else 'not_submitted',
           'probes':probes,'uiTouched':probes>0,'elapsedSeconds':round(clock()-started,1)}
  # Expired items stop consuming repeated grid/editor scans; other shots keep progressing.
  skip=[report['ref']+':'+sid for sid in unresolved]
  remaining=min(max_seconds-(clock()-started),*(idle_seconds-r['ageSeconds'] for r in waiting))
  sleep(max(0,min(poll_seconds,remaining)))

def batch_status(manifest_file,now=None,idle_seconds=300,detailed=False):
 from flow_scale import audit_batch
 audit=audit_batch(manifest_file);jobs=[];counts={}
 for job in audit['items']:
  report=plan_status(job['plan'],now=now,idle_seconds=idle_seconds)
  for action,count in report['counts'].items():counts[action]=counts.get(action,0)+count
  row={k:report[k] for k in ('ref','expertSlug','counts')}
  if detailed:row['items']=report['items']
  jobs.append(row)
 return {'schema':'flow-batch-progress/v1','jobs':jobs,'counts':counts,'generationSubmitted':False,'uiTouched':False}

def collect_batch(manifest_file,targets_file,idle_seconds=300,max_seconds=900,poll_seconds=15,*,clock=time.time,sleep=time.sleep,probe=probe_once):
 from flow_scale import audit_batch
 from flow_parallel import read_targets,verify_targets
 for value,label in [(idle_seconds,'Idle threshold'),(max_seconds,'Maximum duration'),(poll_seconds,'Poll interval')]:positive(value,label)
 audit=audit_batch(manifest_file);targets=read_targets(audit,targets_file);started=clock();seen=set();errors={};probes=0;verified=set()
 while True:
  jobs=[];waiting=False;recover=False
  for job in audit['items']:
   report=plan_status(job['plan'],now=clock(),idle_seconds=idle_seconds);key=job['jobKey']
   active=[r for r in report['items'] if r['state'] in {'submitted','uncertain','submission_intent'}]
   if active and key not in errors and clock()-started<max_seconds and (key not in seen or report['counts'].get('poll',0)):
    skip=[] if key not in seen else [report['ref']+':'+r['shot'] for r in report['items'] if r['nextAction']=='recover_existing']
    try:
     if key not in verified:verify_targets({key:targets[key]});verified.add(key)
     probe(job['plan'],skip,max(.1,min(60,max_seconds-(clock()-started))),targets[key])
    except (ValueError,RuntimeError,subprocess.TimeoutExpired) as error:errors[key]=type(error).__name__
    probes+=1;seen.add(key);report=plan_status(job['plan'],now=clock(),idle_seconds=idle_seconds)
   waiting=waiting or bool(report['counts'].get('poll')) and key not in errors
   recover=recover or bool(report['counts'].get('recover_existing')) or key in errors
   jobs.append({k:report[k] for k in ('ref','expertSlug','counts')} | {'recoveryItems':[r['shot'] for r in report['items'] if r['nextAction']=='recover_existing'],**({'probeError':errors[key]} if key in errors else {})})
  if not waiting or clock()-started>=max_seconds:
   all_collected=all(j['counts'].get('review',0)==job['shots'] for j,job in zip(jobs,audit['items']))
   return {'schema':'flow-batch-collection/v1','status':'needs_recovery' if recover or waiting else 'collected' if all_collected else 'not_submitted','jobs':jobs,'probes':probes,'elapsedSeconds':round(clock()-started,1),'uiTouched':probes>0,'generationSubmitted':False}
  sleep(min(poll_seconds,max_seconds-(clock()-started)))
