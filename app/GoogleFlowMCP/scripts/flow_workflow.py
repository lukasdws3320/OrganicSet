"""One model-independent Flow transaction from an expert-owned, pinned plan."""
import json,os,time,re,shutil
from pathlib import Path
from types import SimpleNamespace
from flow_plan import load_plan,run_plan,sha,write_json

PROTECTED={'submitted','submission_intent','uncertain','available','blocked','failed'}

def pinned_initial_image(image,root,slug,ref):
 """Immutable upload alias named by content: the same bytes keep one remote name for every shot."""
 digest=sha(image)
 folder=root/'initial-images';folder.mkdir(parents=True,exist_ok=True)
 target=folder/(ref+'__'+slug+'__'+digest[:20]+re.sub(r'[^A-Za-z0-9.]','',image.suffix or '.png'))
 if target.exists() and sha(target)!=digest:raise ValueError('Pinned initial-image alias was changed')
 if not target.exists():shutil.copy2(image,target)
 return target

def context_for_plan(plan):
 rep=json.loads(Path(plan['source']['replicationPath']).read_text())
 if rep.get('expert')!=plan.get('expert') or rep.get('ref')!=plan.get('ref'):
  raise ValueError('Plan and source expert/reference differ')
 organization=plan.get('organization',{})
 if organization.get('collectionName')!=plan['ref'] or not organization.get('expertProjectName') or not organization.get('projectUrl'):
  raise ValueError('Bind the expert project and reference collection before execution')
 identity=plan.get('identity')
 if identity:
  if identity.get('expertSlug')!=rep.get('slug') or identity.get('avatarName')!=rep.get('avatar'):
   raise ValueError('Contact sheet identity belongs to another expert/avatar')
  sheet=identity['contactSheet']
  if sha(sheet['path'])!=sheet['sha256']:raise ValueError('Expert contact sheet changed; verify identity before execution')
 from flow_identity import validate_contract
 contract=validate_contract(plan)
 return {'expert':rep['expert'],'expertSlug':rep['slug'],'avatarName':rep['avatar'],
         'projectName':organization['expertProjectName'],'projectUrl':organization['projectUrl'],
         'reference':plan['ref'],'contactSheetVerified':bool(identity),
         'voiceMention':plan['settings'].get('voiceMention'),'voiceOption':plan['settings'].get('voiceOption'),
         'jobKey':contract['jobKey'],'identityContractVerified':contract['identityContractVerified'],'audioPolicy':contract['audioPolicy'],'voiceTimbreVerified':False}

def pick_shot(plan,state,number):
 if number is not None:
  if isinstance(number,bool) or number<1 or number>len(plan['shots']):raise ValueError('Shot number is outside the current production plan')
  return number,plan['shots'][number-1]
 return next(((n,shot) for n,shot in enumerate(plan['shots'],1) if state.get('items',{}).get(shot['id'],{}).get('status') not in PROTECTED),(None,None))

def ensure_initial_image(flow,image,root,ref,project=None,identity=None):
 from flow_organization import bind_collection_image,drop_images
 import flow_asset_registry as registry
 if ref not in image.name:raise ValueError('Initial image filename must identify its own reference')
 def rows():return flow.js("[...document.querySelectorAll('flow-grid-tile-container')].map(e=>({name:e.getAttribute('aria-label'),assetId:e.querySelector('img[data-media-id]')?.getAttribute('data-media-id')}))")
 digest=sha(image)
 def remember(binding):
  if project:registry.record(project,ref,digest,assetId=binding['assetId'],pickerName=binding['pickerName'],status='available')
  return binding
 if project:
  def bind_known(entry):
   from flow_organization import reveal_asset
   if not reveal_asset(flow,entry['assetId']):raise ValueError('Registered asset is not visible in this collection after showing Images and scrolling the whole grid; recover it, no new upload')
   return bind_collection_image(flow,entry.get('pickerName'),asset_id=entry['assetId'])
  def await_holder():
   done=registry.wait_available(project,ref,digest)
   if not done:raise ValueError('Previous collection upload is uncertain; recover the existing image before uploading again')
   return bind_known(done)
  shared=registry.shared_lookup(project,ref,digest,identity)
  if shared:
   # Frames picker searches Uploads globally and verifies the actual asset ID before submit.
   registry.record(project,ref,digest,assetId=shared['assetId'],pickerName=shared['pickerName'],status='available',shared=True)
   return {'pickerName':shared['pickerName'],'assetId':shared['assetId'],'sharedAsset':True,'sharedProof':{k:shared[k] for k in ('sha256','expertSlug','contactSheetSha256','references','project')}}
  known=registry.lookup(project,ref,digest)
  if known and known.get('assetId'):return bind_known(known)
  if known and known.get('status')=='upload_intent':return await_holder()
  # Same bytes already uploaded under another alias: never add one more copy; adopt one exact asset first.
  same=[r for r in rows() if r.get('name') and digest[:20] in r['name']]
  if [r['name'] for r in same]==[image.name]:return remember(bind_collection_image(flow,image.name))
  if same:raise ValueError(f'This image content is already in the collection {len(same)} time(s); register the chosen asset ID (flow-control register-asset) before use. No upload.')
  # Reserve before any drop: a concurrent process for the same content waits for this upload.
  state,entry=registry.reserve_upload(project,ref,digest,name=image.name,owner=str(root))
  if state=='available':return bind_known(entry)
  if state=='intent':return await_holder()
 matches=[r for r in rows() if r.get('name')==image.name]
 if matches:return remember(bind_collection_image(flow,image.name))
 log=root/'flow-collection-uploads.json'
 uploads=json.loads(log.read_text()) if log.exists() else {}
 if uploads.get(digest,{}).get('status')=='upload_intent':raise ValueError('Previous collection upload is uncertain; recover the existing image before uploading again')
 uploads[digest]={'name':image.name,'status':'upload_intent','time':time.time()};write_json(log,uploads)
 if os.environ.get('FLOW_NO_UPLOAD')=='1':raise ValueError('Upload blocked by FLOW_NO_UPLOAD=1 (preflight); image content is not bound in this collection')
 drop_images(flow,[str(image.resolve())])
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  try:
   binding=bind_collection_image(flow,image.name)
   uploads[digest]={**binding,'status':'available','sha256':digest};write_json(log,uploads)
   return remember(binding)
  except ValueError:time.sleep(.2)
 raise RuntimeError('Image upload is not yet confirmed; preserved upload intent, no automatic duplicate')

def upload_initial_images(paths,root,ref,slug,project,expert,flow=None,wait=45,clock=time.monotonic,sleep=time.sleep):
 """Um único drop na coleção da REF com tudo que falta; o conteúdo já enviado é reaproveitado pelo hash."""
 from flow_organization import ensure_collection,drop_images,bind_collection_image,TILE_ROWS
 import flow_asset_registry as registry
 if flow is None:
  from flow_control import FlowControl
  flow=FlowControl()
 ensure_collection(flow,expert,ref,project)
 aliases={}
 for raw in paths:
  alias=pinned_initial_image(Path(raw),Path(root),slug,ref);aliases.setdefault(sha(alias),alias)
 rows=flow.js(TILE_ROWS);reused=0;pending={}
 for digest,alias in aliases.items():
  known=registry.lookup(project,ref,digest)
  if known and known.get('assetId'):reused+=1;continue
  match=next((r for r in rows if r.get('name')==alias.name and r.get('assetId')),None)
  if match:registry.register_existing_asset(project,ref,alias,match['assetId'],alias.name);reused+=1;continue
  state,entry=registry.reserve_upload(project,ref,digest,name=alias.name,owner=str(root))
  if state=='available':reused+=1
  elif state=='reserved':pending[digest]=alias
 if pending:drop_images(flow,[str(a.resolve()) for a in pending.values()])
 uploaded=len(pending);deadline=clock()+wait;refreshed=False
 while pending:
  rows=flow.js(TILE_ROWS)
  for digest,alias in list(pending.items()):
   match=next((r for r in rows if r.get('name')==alias.name and r.get('assetId')),None)
   if match:registry.record(project,ref,digest,assetId=match['assetId'],pickerName=alias.name,status='available');pending.pop(digest)
  if not pending:break
  if clock()>=deadline:
   if refreshed:break
   flow.js('location.reload();true');sleep(4);refreshed=True;deadline=clock()+wait/3
   for digest,alias in list(pending.items()):
    try:
     binding=bind_collection_image(flow,alias.name);registry.record(project,ref,digest,assetId=binding['assetId'],pickerName=binding['pickerName'],status='available');pending.pop(digest)
    except ValueError:pass
   continue
  sleep(.5)
 return {'reference':ref,'images':len(aliases),'reused':reused,'uploaded':uploaded,'unconfirmed':[a.name for a in pending.values()],'generationSubmitted':False}

def execute_plan(plan_file,number=None,submit=False):
 from flow_control import FlowControl
 from flow_organization import ensure_collection,bind_collection_image
 plan_file=str(Path(plan_file).resolve());plan,_=load_plan(plan_file)
 context=context_for_plan(plan);root=Path(plan['outputDir'])
 def phase(value,**kwargs):
  options=dict(plan=plan_file,phase=value,kind='shot',item=None,file=None,asset_id=None,picker_name=None,project=None,quote=None,submit_name=None,acknowledge_spend=False,approved=False,check_only=False)
  options.update(kwargs);return run_plan(SimpleNamespace(**options))
 phase('prepare')
 state=json.loads((root/'flow-run.json').read_text());index,shot=pick_shot(plan,state,number)
 if shot is None:return {**context,'status':'nothing_to_prepare','willSubmit':False}
 prior=state['items'].get(shot['id'],{})
 if prior.get('status') in PROTECTED:
  return {**context,'number':index,'item':shot['id'],'status':prior['status'],'action':'recover_existing','willSubmit':False}
 flow=FlowControl()
 organization=ensure_collection(flow,context['projectName'],context['reference'],context['projectUrl'])
 still=next(s for s in plan['stills'] if s['id']==shot['still'])
 image=Path(still['output'])
 if not image.is_file():raise ValueError('Selected initial image is missing; produce/select it with this expert contact sheet before execution')
 if context['identityContractVerified']:image=pinned_initial_image(image,root,context['expertSlug'],context['reference'])
 identity=plan.get('identity')
 identity=identity and {'expertSlug':identity.get('expertSlug'),'contactSheetSha256':identity.get('contactSheet',{}).get('sha256')}
 binding=ensure_initial_image(flow,image,root,context['reference'],project=context['projectUrl'],identity=identity)
 for extra in (plan['settings'].get('identityImages',[]) if plan['settings'].get('videoMode')=='Ingredients' else []):ensure_initial_image(flow,Path(extra),root,context['reference'])
 previous=state['items'].get(still['id'],{})
 phase('record',kind='still',item=still['id'],file=str(image.resolve()),asset_id=binding['assetId'],picker_name=binding['pickerName'],project=context['projectUrl'],quote=previous.get('quotedCredits',0),approved=bool(previous.get('humanApproved') or plan.get('selection',{}).get('videoRequiresSelectedCandidate') is False))
 phase('video',item=shot['id'])
 from flow_drafts import register_draft
 register_draft(flow,plan_file,shot['id'])
 prepared=json.loads((root/'flow-run.json').read_text())['items'][shot['id']]
 quote=prepared['settingsSnapshot']['quote']
 result=phase('submit',item=shot['id'],quote=quote,submit_name='Start generation',acknowledge_spend=True,check_only=not submit)
 receipt={**context,'number':index,'label':f'Shot {index:02d}','item':shot['id'],'collectionUrl':organization['collectionUrl'],**result,'willSubmit':bool(submit)}
 write_json(root/(shot['id']+'.workflow.json'),receipt)
 return receipt
