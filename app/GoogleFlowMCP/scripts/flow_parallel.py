"""Independent tabs, bounded local workers and durable intents; no paid retries."""
import fcntl,json,os,subprocess,threading,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse
from flow_plan import sha,write_json
from flow_scale import audit_batch

def verify_targets(targets,flow=None):
 if len(set(targets.values()))!=len(targets) or any(not isinstance(v,str) or not v for v in targets.values()):raise ValueError('Each active job needs a distinct tab')
 if flow is None:
  from flow_control import FlowControl
  flow=FlowControl()
 infos={t['targetId']:t for t in flow.h.cdp('Target.getTargets').get('targetInfos',[])}
 if flow.target not in infos:raise ValueError('Configured profile tab is missing')
 context=infos[flow.target].get('browserContextId')
 for target in targets.values():
  if target==flow.target:raise ValueError('Keep the coordinator tab separate from worker tabs')
  row=infos.get(target,{})
  if not row or row.get('browserContextId')!=context:raise ValueError('Worker tab is missing or belongs to another profile')
  url=urlparse(row.get('url',''))
  if row.get('type')!='page' or url.scheme!='https' or url.hostname!='flow.google.com':raise ValueError('Worker tab is not a Flow page')

def live_tab_report(targets,flow):
 """Read-only: which bound tabs exist now, as Flow pages, in the configured profile context."""
 infos={t['targetId']:t for t in flow.h.cdp('Target.getTargets').get('targetInfos',[])}
 context=infos.get(flow.target,{}).get('browserContextId')
 if flow.target not in infos:raise ValueError('Configured profile tab is missing')
 report={}
 for job,target in targets.items():
  row=infos.get(target);url=urlparse((row or {}).get('url',''))
  report[job]={'targetId':target,'present':bool(row),'sameContext':bool(row) and row.get('browserContextId')==context,'type':(row or {}).get('type'),'flowPage':url.scheme=='https' and url.hostname=='flow.google.com'}
 return report

def confirm_tabs(targets,flow,timeout=30,settle=3,clock=time.monotonic,sleep=time.sleep):
 """After creation, each tab must load as a Flow page in the same context and still exist after a settle delay."""
 deadline=clock()+timeout
 while True:
  report=live_tab_report(targets,flow)
  if all(r['present'] and r['sameContext'] and r['type']=='page' and r['flowPage'] for r in report.values()):break
  if clock()>=deadline:return report
  sleep(.5)
 sleep(settle)
 return live_tab_report(targets,flow)

DEFINITIVE_CREATE_ERROR='Failed to find browser context'

def recover_failed_creation_intent(manifest_file,output,error,flow=None):
 """Clear a legacy creationIntent only with the known definitive error and no unbound tab of that project in the profile."""
 if DEFINITIVE_CREATE_ERROR not in error:raise ValueError('Only a definitive creation rejection can clear an intent')
 report=audit_batch(manifest_file);file=Path(output).resolve();data=json.loads(file.read_text())
 if data.get('schema')!='flow-batch-targets/v1' or data.get('manifestSha256')!=report['manifestSha256']:raise ValueError('Tab bindings belong to another batch')
 key=data.get('creationIntent');job=next((j for j in report['items'] if j['jobKey']==key),None)
 if not job:raise ValueError('No recoverable creation intent')
 if flow is None:
  from flow_control import FlowControl
  flow=FlowControl()
 infos=flow.h.cdp('Target.getTargets').get('targetInfos',[]);context=next(t for t in infos if t['targetId']==flow.target).get('browserContextId')
 bound=set(data['targets'].values())|{flow.target}
 if any(t['targetId'] not in bound and t.get('browserContextId')==context and t.get('url','').startswith(job['projectUrl']) for t in infos):raise ValueError('An unbound tab of this project exists; recover it instead of clearing')
 data.setdefault('creationFailures',[]).append({'jobKey':key,'error':error[:300],'noUnboundProjectTab':True,'recoveredAt':time.time()})
 data.pop('creationIntent');write_json(file,data)
 return {'path':str(file),'cleared':key,'generationSubmitted':False}

def open_child_tab(flow,url,project_url,context,timeout=30,clock=time.monotonic,sleep=time.sleep):
 before={t['targetId'] for t in flow.h.cdp('Target.getTargets').get('targetInfos',[])}
 params={'url':url,'background':True}
 if context:params['browserContextId']=context
 target=None
 try:target=flow.h.cdp('Target.createTarget',**params).get('targetId')
 except Exception as error:
  if DEFINITIVE_CREATE_ERROR not in str(error):raise
  # Chrome não expõe certos contextos de perfil como gerenciados. Reusar somente o perfil Flow já existente, sem foco.
  from flow_control import FLOW_CHROME_PROFILE
  from plataforma import abrir_chrome
  abrir_chrome(FLOW_CHROME_PROFILE,url)
 try:
  deadline=clock()+timeout
  while True:
   kids=[t for t in flow.h.cdp('Target.getTargets').get('targetInfos',[]) if (t['targetId']==target if target else t['targetId'] not in before and t.get('url','').startswith(project_url)) and t.get('type')=='page']
   if any(t.get('browserContextId')!=context for t in kids):raise ValueError('Opened tab is not a page in the configured profile; preserved creation intent')
   if len(kids)>1:raise ValueError('More than one child tab appeared; preserved creation intent')
   url_now=kids[0].get('url','') if kids else ''
   if kids and url_now.startswith(project_url):
    if not target:
     try:
      window=flow.h.cdp('Browser.getWindowForTarget',targetId=kids[0]['targetId'])['windowId']
      flow.h.cdp('Browser.setWindowBounds',windowId=window,bounds={'windowState':'minimized'})
     except Exception:pass
    return kids[0]['targetId']
   if kids and url_now not in ('','about:blank'):raise ValueError('Opened tab is not the expected Flow project; preserved creation intent')
   if clock()>=deadline:raise RuntimeError('No unique child tab reached the project; preserved creation intent')
   sleep(.5)
 except Exception:
  if target:
   try:flow.h.cdp('Target.closeTarget',targetId=target)
   except Exception:pass
  raise

def place_window(flow,target,index):
 # A posição das janelas pertence ao usuário; renderização em fundo é emulada por FlowControl.
 return None

def ensure_tab(key,project,flow=None,file=None,opener=open_child_tab):
 """Uma aba por chave, no mesmo perfil do coordenador; aba fechada é reaberta, nunca duplicada."""
 if flow is None:
  from flow_control import FlowControl
  flow=FlowControl()
 from flow_control import tab_bindings_file
 path=Path(file) if file else tab_bindings_file();path.parent.mkdir(parents=True,exist_ok=True)
 with (path.parent/(path.name+'.lock')).open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  data=json.loads(path.read_text()) if path.exists() else {'schema':'flow-tab-bindings/v1','targets':{}}
  infos={t['targetId']:t for t in flow.h.cdp('Target.getTargets').get('targetInfos',[])}
  context=infos[flow.target].get('browserContextId');bound=infos.get(data['targets'].get(key))
  if bound and bound.get('browserContextId')==context and bound.get('type')=='page' and urlparse(bound.get('url','')).hostname=='flow.google.com':
   place_window(flow,bound['targetId'],list(data['targets']).index(key));return {'key':key,'targetId':bound['targetId'],'created':False}
  intents=data.setdefault('creationIntents',{})
  if key in intents:
   prior=intents[key];known=set(prior.get('before',[]))
   recovered=[t for t in infos.values() if t['targetId'] not in known and t.get('type')=='page' and t.get('browserContextId')==context and t.get('url','').split('?')[0].rstrip('/')==project.rstrip('/')]
   if len(recovered)!=1:raise RuntimeError('Criação anterior de target aguarda recuperação; nenhuma nova aba foi aberta.')
   target=recovered[0]['targetId']
  else:
   intents[key]={'project':project,'before':list(infos),'at':time.time()};write_json(path,data)
   target=opener(flow,project+'?hl=en',project,context)
  intents.pop(key,None);data['targets'][key]=target;write_json(path,data);place_window(flow,target,list(data['targets']).index(key))
  # Janela nova: o projeto só aparece no título depois de carregar, e a conferência do expert lê esse título.
  deadline=time.monotonic()+15
  while time.monotonic()<deadline and ' - ' not in next((t.get('title','') for t in flow.h.cdp('Target.getTargets').get('targetInfos',[]) if t['targetId']==target),' - '):time.sleep(.2)
  return {'key':key,'targetId':target,'created':True}

def prepare_batch_tabs(manifest_file,output,flow=None,timeout=30,settle=3):
 report=audit_batch(manifest_file);file=Path(output).resolve()
 data=json.loads(file.read_text()) if file.exists() else {'schema':'flow-batch-targets/v1','manifestSha256':report['manifestSha256'],'targets':{}}
 if data.get('schema')!='flow-batch-targets/v1' or data.get('manifestSha256')!=report['manifestSha256']:raise ValueError('Tab bindings belong to another batch')
 if not isinstance(data.get('targets'),dict) or not set(data['targets']).issubset(j['jobKey'] for j in report['items']):raise ValueError('Unexpected job in tab bindings')
 if data.get('creationIntent'):raise ValueError('Tab creation was interrupted; recover the existing tab before creating another')
 if flow is None:
  from flow_control import FlowControl
  flow=FlowControl()
 # A binding whose tab no longer exists anywhere cannot be duplicated by recreating it; record the loss and rebind.
 for job,row in live_tab_report(data['targets'],flow).items():
  if not row['present']:data.setdefault('lostTargets',[]).append({'jobKey':job,'targetId':row['targetId'],'detectedAt':time.time()});data['targets'].pop(job)
 write_json(file,data)
 verify_targets(data['targets'],flow)
 infos=flow.h.cdp('Target.getTargets').get('targetInfos',[]);current=next(t for t in infos if t['targetId']==flow.target)
 managed=flow.h.cdp('Target.getBrowserContexts').get('browserContextIds',[])
 file.parent.mkdir(parents=True,exist_ok=True)
 for job in report['items']:
  if job['jobKey'] in data['targets']:continue
  data['creationIntent']=job['jobKey'];write_json(file,data)
  params={'url':job['projectUrl']+'?hl=en','background':True}
  if current.get('browserContextId') in managed:params['browserContextId']=current['browserContextId']
  else:
   # The default profile's context is not addressable by createTarget; a child opened by the configured tab inherits it.
   data['targets'][job['jobKey']]=open_child_tab(flow,params['url'],job['projectUrl'],current.get('browserContextId'),timeout);data.pop('creationIntent');write_json(file,data);continue
  before={t['targetId'] for t in flow.h.cdp('Target.getTargets').get('targetInfos',[])}
  try:target=flow.h.cdp('Target.createTarget',**params).get('targetId')
  except Exception as error:
   if not DEFINITIVE_CREATE_ERROR in str(error):raise
   if {t['targetId'] for t in flow.h.cdp('Target.getTargets').get('targetInfos',[])}-before:raise
   data.setdefault('creationFailures',[]).append({'jobKey':job['jobKey'],'error':str(error)[:300],'contextSent':'browserContextId' in params,'noNewTarget':True,'detectedAt':time.time()})
   data.pop('creationIntent');write_json(file,data);raise
  if not target:raise RuntimeError('Tab creation was not acknowledged; preserved creation intent')
  data['targets'][job['jobKey']]=target;data.pop('creationIntent');write_json(file,data)
 final=confirm_tabs(data['targets'],flow,timeout=timeout,settle=settle)
 gone=[j for j,r in final.items() if not r['present']];wrong=[j for j,r in final.items() if r['present'] and not (r['sameContext'] and r['type']=='page' and r['flowPage'])]
 if gone:
  for job in gone:data.setdefault('lostTargets',[]).append({'jobKey':job,'targetId':data['targets'].pop(job),'detectedAt':time.time()})
  write_json(file,data)
  raise RuntimeError(f'{len(gone)} created tab(s) disappeared after creation; bindings removed, nothing submitted. Investigate before retrying.')
 if wrong:raise ValueError('Tab is not a Flow page in the configured profile: '+', '.join(wrong))
 data['verifiedAt']=time.time();write_json(file,data)
 return {'path':str(file),'jobs':len(data['targets']),'verifiedPresent':sorted(data['targets'].values()),'generationSubmitted':False,'uiTouched':True}

def submit_transaction(plan,number,target):
 env={**os.environ,'FLOW_TARGET_ID':target}
 from plataforma import comando_flow_control
 command=[*comando_flow_control(),'execute-plan','--plan',str(plan),'--shot-number',str(number),'--submit']
 result=subprocess.run(command,env=env,capture_output=True,text=True,timeout=180)
 try:receipt=json.loads(result.stdout.strip().splitlines()[-1])
 except ValueError:raise RuntimeError('Worker did not return an execution receipt')
 if result.returncode:raise RuntimeError('Worker stopped; recover the persisted production state')
 return receipt

def read_targets(report,targets_file):
 binding=json.loads(Path(targets_file).read_text())
 if binding.get('schema')!='flow-batch-targets/v1' or binding.get('manifestSha256')!=report['manifestSha256'] or binding.get('creationIntent'):raise ValueError('Tab bindings differ from batch or need recovery')
 targets=binding.get('targets',{})
 if not isinstance(targets,dict) or set(targets)!=set(j['jobKey'] for j in report['items']):raise ValueError('Every batch job needs an explicit tab binding')
 if any(not isinstance(v,str) or not v for v in targets.values()) or len(set(targets.values()))!=len(targets):raise ValueError('Each job needs a distinct tab')
 return targets

def run_parallel_batch(manifest_file,targets_file,workers=3,limit=None):
 lock=Path(manifest_file).resolve().with_name(Path(manifest_file).name+'.queue.lock')
 with lock.open('a') as handle:
  try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError('Another coordinator owns this batch journal')
  return _run_parallel_batch(manifest_file,targets_file,workers,limit)

def _run_parallel_batch(manifest_file,targets_file,workers,limit):
 if isinstance(workers,bool) or not isinstance(workers,int) or not 1<=workers<=9:raise ValueError('Workers must be between 1 and 9')
 if limit is not None and (isinstance(limit,bool) or not isinstance(limit,int) or limit<1):raise ValueError('Limit must be a positive integer')
 report=audit_batch(manifest_file);file=Path(report['manifest']);targets=read_targets(report,targets_file)
 journal=file.with_name(file.name+'.state.json')
 state=json.loads(journal.read_text()) if journal.exists() else {'schema':'flow-batch-run/v1','manifestSha256':report['manifestSha256'],'items':{}}
 if state.get('manifestSha256')!=report['manifestSha256']:raise ValueError('Batch journal belongs to another manifest')
 pending=[];recover=[]
 for job in report['items']:
  rows=[]
  for number,(sid,status) in enumerate(job['shotStates'].items(),1):
   key=job['jobKey']+':'+sid;prior=state['items'].get(key,{})
   if status in {'submitted','available'}:
    if prior.get('status') in {'execution_intent','needs_recovery'}:state['items'][key].update(status=status,reconciledFromProductionState=True)
    continue
   if prior.get('status') in {'submitted','available'}:continue
   if prior.get('status') in {'execution_intent','needs_recovery'} or status in {'uncertain','submission_intent','failed','blocked'}:recover.append(key);continue
   rows.append((number,sid,key))
  if rows:pending.append((job,rows))
 if pending:verify_targets({job['jobKey']:targets[job['jobKey']] for job,_ in pending})
 mutex=threading.Lock();attempted=0
 def execute(job_rows):
  nonlocal attempted
  job,rows=job_rows
  for number,sid,key in rows:
   with mutex:
    if limit is not None and attempted>=limit:return
    if sha(file)!=report['manifestSha256'] or sha(job['plan'])!=job['planSha256']:raise ValueError('Pinned batch or plan changed during execution')
    state['items'][key]={'status':'execution_intent','plan':job['plan'],'planSha256':job['planSha256'],'number':number,'shot':sid,'time':time.time(),'targetId':targets[job['jobKey']]}
    write_json(journal,state);attempted+=1
   try:
    receipt=submit_transaction(job['plan'],number,targets[job['jobKey']]);status=receipt.get('status')
    record={'status':status if status in {'submitted','available'} else 'needs_recovery','receipt':receipt}
   except Exception as error:record={'status':'needs_recovery','errorType':type(error).__name__}
   with mutex:
    state['items'][key].update(record);write_json(journal,state)
    if record['status']=='needs_recovery':recover.append(key);return
 with ThreadPoolExecutor(max_workers=workers) as pool:list(pool.map(execute,pending))
 # Persist offline reconciliations even when no browser work remains.
 if journal.exists():write_json(journal,state)
 status='needs_recovery' if recover else 'limited' if limit is not None and sum(len(rows) for _,rows in pending)>attempted else 'submitted'
 return {'status':status,'state':str(journal),'attempted':attempted,'workers':workers,'recoveryItems':recover,
         'generationSubmitted':any(r.get('status')=='submitted' for r in state['items'].values()),'uiTouched':attempted>0,'qualityApproved':False,
         'note':'Independent jobs continue after one fails; submitted/uncertain work is never automatically retried. Collect and review separately.'}

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser(description='Clear a failed tab-creation intent with proof');p.add_argument('command',choices=['recover-creation-intent']);p.add_argument('--manifest',required=True);p.add_argument('--output',required=True);p.add_argument('--error',required=True)
 a=p.parse_args();print(json.dumps(recover_failed_creation_intent(a.manifest,a.output,a.error),ensure_ascii=False))
