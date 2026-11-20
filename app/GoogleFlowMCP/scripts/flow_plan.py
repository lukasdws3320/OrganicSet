"""Small phase runner for a pinned Reference Hub plan; no paid retry or hidden generation."""
import hashlib,json,math,re,shutil,time
from pathlib import Path
from urllib.parse import urlparse
PRESETS=(4,6,8,10)
def validate_reference_proofs(composer,proofs):
 actual=[str(r.get('media','')).rstrip('/').split('/')[-1] for r in composer['references'] if r.get('media')!='voice_selection']
 expected=[p.get('assetId') for p in proofs]
 if not all(expected) or sorted(actual)!=sorted(expected):raise ValueError('Attached image asset IDs differ from the exact picker options; no submission allowed')
def model_key(value):
 value=re.sub(r'\b(?:arrow_drop_down|expand_more|expand_less|check_small|check)\b','',value,flags=re.I)
 # Selo de descontinuação do Flow (09/11/2026): "Veo 3.1 - Quality Leaving Dec 5" é o mesmo modelo.
 value=re.sub(r'\bLeaving\s+[A-Za-z]{3,9}\.?\s+\d{1,2}\b','',value,flags=re.I)
 return re.sub(r'[^a-z0-9.]+','',value.lower())
def validate_mentions(composer,settings):
 spec=settings.get('voiceMention')
 audio=settings.get('audio') or {}
 voices=[m for m in composer.get('mentions',[]) if m.get('type')=='audio']
 if spec:
  if spec.get('authorizedByUser') is not True or not re.fullmatch(r'voices/[A-Za-z0-9_-]+',str(spec.get('id',''))) or not spec.get('display') or settings.get('videoMode')!='Frames':raise ValueError('Invalid voice mention authorization')
  mentions=composer.get('mentions',[])
  if len(mentions)!=1 or mentions[0].get('id')!=spec['id'] or mentions[0].get('type')!='audio' or mentions[0].get('text')!=spec['display']:raise ValueError('Exact authorized voice mention missing or changed')
  if mentions[0].get('invalid') and (audio.get('voiceBinding')=='required' or audio.get('allowInvalidMention') is False):raise ValueError('Required voice binding is not active; invalid mention cannot condition audio')
 elif voices:raise ValueError('Unexpected voice mention from another character or previous draft')
 elif composer.get('invalidMentions'):raise ValueError('Invalid voice/asset mention; no submission allowed')
 voice_refs=[r for r in composer['references'] if r.get('media')=='voice_selection']
 if voice_refs and not settings.get('voiceOption'):raise ValueError('Unexpected voice ingredient from another character or previous draft')
 if audio.get('voiceBinding')=='required' and not spec:raise ValueError('Required voice binding needs an observable exact voice ID; a generic voice ingredient is insufficient')
 if any(r.get('disabled') for r in composer['references']):raise ValueError('Disabled reference; no submission allowed')
 return {'voiceBindingVerified':bool(spec and voices and voices[0].get('invalid') is False),'voiceTimbreVerified':False,'voiceIdentityStatus':'active-mention' if spec and voices and voices[0].get('invalid') is False else 'unverified' if spec or voice_refs else 'not-requested'}
# Renomes cadastrais conhecidos (01/11/2026): aceitos só se a fonte atual, com o nome antigo de volta, reproduzir exatamente o hash gravado.
from flow_identity import RENAMED_SLUGS
def renamed_source_matches(plan,path,expected):
 old=(plan.get('identity') or {}).get('expertSlug');new=RENAMED_SLUGS.get(old)
 return bool(new and path and Path(path).exists() and hashlib.sha256(Path(path).read_text().replace(new,old).encode()).hexdigest()==expected)
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as source:
  for chunk in iter(lambda:source.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def load_plan(path):
 path=Path(path);plan=json.loads(path.read_text())
 if plan.get('schema')!='flow-replication-plan/v1':raise ValueError('Unsupported Flow plan schema')
 settings=plan['settings']
 if settings.get('count')!=1 or isinstance(settings.get('count'),bool) or isinstance(settings.get('maxCredits'),bool) or not isinstance(settings.get('maxCredits'),(int,float)) or not math.isfinite(settings['maxCredits']) or settings['maxCredits']<0:raise ValueError('Plan must request one output and provide a finite nonnegative authorized credit maximum')
 if settings.get('videoMode','Frames') not in ('Frames','Ingredients'):raise ValueError('Invalid video mode')
 if settings.get('voiceOption') and settings.get('videoMode')!='Ingredients' and settings.get('voiceInFramesTest') is not True:raise ValueError('Voice requires Ingredients mode')
 if settings.get('imageCount',1) not in (1,2,3,4):raise ValueError('Invalid image candidate count')
 if not re.fullmatch(r'[A-Za-z0-9_-]+',plan.get('ref','')):raise ValueError('Invalid reference ID')
 for label,key in [('analysis','analysisPath'),('replication','replicationPath')]:
  source=plan['source'].get(key)
  if not source or sha(source)!=plan['source'][label+'Sha256'] and not renamed_source_matches(plan,source,plan['source'][label+'Sha256']):raise ValueError('Source changed: '+label+'; export the plan again before UI work')
 if plan['source'].get('expertProfilePath') and sha(plan['source']['expertProfilePath'])!=plan['source'].get('expertProfileSha256') and not renamed_source_matches(plan,plan['source']['expertProfilePath'],plan['source'].get('expertProfileSha256')):
  raise ValueError('Expert production profile changed; export/review this expert plan before UI work')
 if plan['source'].get('selectedImagesPath') and sha(plan['source']['selectedImagesPath'])!=plan['source'].get('selectedImagesSha256'):
  raise ValueError('Selected-image manifest changed; review the exact expert/reference images before UI work')
 names={};ids=set()
 for asset in plan['assets']:
  if asset['id'] in ids:raise ValueError('Duplicate asset ID')
  ids.add(asset['id'])
  if not Path(asset['path']).is_absolute() or sha(asset['path'])!=asset['sha256']:raise ValueError('Asset changed: '+asset['id'])
  name=asset['name']
  if name in names and names[name]!=asset['sha256']:raise ValueError('Same asset filename has different content; rename before export')
  names[name]=asset['sha256']
 still_ids=set()
 for still in plan['stills']:
  if still['id'] in still_ids or not set(still['inputs']).issubset(ids):raise ValueError('Invalid still/input IDs')
  still_ids.add(still['id'])
 shot_ids=set()
 for shot in plan['shots']:
  if shot['id'] in shot_ids or shot['still'] not in still_ids:raise ValueError('Invalid shot/still IDs')
  shot_ids.add(shot['id']);window=shot['sourceWindow'];source=shot['sourceDuration']
  if len(window)!=2 or not all(isinstance(n,(int,float)) and math.isfinite(n) for n in window) or window[1]<=window[0] or abs(window[1]-window[0]-source)>0.002:raise ValueError('Invalid source duration/window')
  speech=len(re.findall(r'\S+',shot.get('speech','')))/3.2 if shot.get('speechMode','generated')=='generated' else 0
  evidence=shot.get('timingEvidence')
  measured=None
  if evidence and evidence.get('kind')=='adapted-speech':
   # Fala reescrita (OrganicSet, 09/11/2026): medida pelo Hub (scripts/medir-fala.ts), registrada na versão da copy.
   measured=evidence.get('speechSeconds')
   if isinstance(measured,bool) or not isinstance(measured,(int,float)) or not math.isfinite(measured) or measured<=0 or not str(evidence.get('source','')).strip():raise ValueError('Invalid adapted speech measurement')
  elif evidence:
   if evidence.get('kind')!='source-speech':raise ValueError('Unsupported measured speech evidence')
   transcript=Path(evidence.get('transcriptPath',''))
   if not transcript.is_absolute() or not transcript.is_file() or sha(transcript)!=evidence.get('transcriptSha256'):raise ValueError('Measured transcript missing or changed')
   words=json.loads(transcript.read_text()).get('palavras',[]);bounds=evidence.get('wordRange',[])
   if len(bounds)!=2 or any(isinstance(n,bool) or not isinstance(n,int) for n in bounds) or not 0<=bounds[0]<bounds[1]<=len(words):raise ValueError('Invalid measured word range')
   selected=words[bounds[0]:bounds[1]]
   literal=re.sub(r'\s+([,.!?…])',r'\1',' '.join(w['w'] for w in selected)).strip()
   measured=selected[-1]['fim']-selected[0]['ini']
   if literal!=shot.get('speech') or selected[0]['ini']<window[0]-.03 or selected[-1]['fim']>window[1]+.03 or measured<=0 or abs(measured-evidence.get('speechSeconds',-100))>.03:raise ValueError('Measured transcript does not bind this complete speech/window')
  if measured is not None:
   allowed=(4,6,8) if settings.get('videoModel','').startswith('Veo') else PRESETS
   minimum=max(measured,shot['requestedDuration']);expected=next((p for p in allowed if p>=minimum),None)
   if expected is None or shot['duration']!=expected:raise ValueError('Measured speech does not fit the requested model duration')
  elif shot.get('durationOverride',{}).get('authorizedByUser') is True:
   allowed=(4,6,8) if settings.get('videoModel')=='Veo 3.1 - Lite' else PRESETS
   if shot['duration'] not in allowed or shot['requestedDuration']!=shot['duration'] or not shot['durationOverride'].get('reason'):
    raise ValueError('Invalid authorized duration review')
  else:
   minimum=max(source,shot['requestedDuration'],speech)
   if not math.isfinite(minimum) or minimum>10:raise ValueError('Shot cannot fit Omni10s without truncating; split it in the source plan')
   expected=next(p for p in PRESETS if p>=minimum)
   if shot['duration']!=expected:raise ValueError('Duration would truncate or disagree with the smallest valid Omni preset')
 if plan.get('editing',{}).get('autoTrim') is not False:raise ValueError('Plan must explicitly disable automatic source-window trimming')
 from flow_identity import validate_contract
 validate_contract(plan)
 return plan,sha(path)
def aliases_for(plan,root):
 by_hash={};aliases={}
 for asset in plan['assets']:
  if asset['sha256'] not in by_hash:
   original=re.sub(r'[^A-Za-z0-9_.-]+','_',asset['name'])
   by_hash[asset['sha256']]=plan['ref']+'__'+asset['sha256'][:12]+'__'+original
  name=by_hash[asset['sha256']];aliases[asset['id']]={'name':name,'path':str(root/'inputs'/name),'sha256':asset['sha256']}
 return aliases

def attachment_prompt(still,assets,aliases):
 prompt=still['prompt']
 for identifier in still['inputs']:
  name=next(a['name'] for a in assets if a['id']==identifier)
  prompt=prompt.replace('@'+name,'@'+aliases[identifier]['name'])
 return prompt

def project_key(url):
 parsed=urlparse(url);match=re.match(r'^/project/([^/]+)',parsed.path)
 if parsed.scheme!='https' or parsed.hostname!='flow.google.com' or not match:raise ValueError('Open the pinned Flow project first')
 return 'https://flow.google.com/project/'+match.group(1)

def write_json(path,value):
 path=Path(path);tmp=path.with_name(path.name+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)
def organize_plan(flow,plan):
 organization=plan.get('organization')
 if organization:
  from flow_organization import ensure_collection
  if organization.get('collectionName')!=plan['ref']:raise ValueError('Collection must match the plan REF')
  return ensure_collection(flow,organization['expertProjectName'],plan['ref'],organization.get('projectUrl'))
def run_plan(args):
 plan,plan_sha=load_plan(args.plan);root=Path(plan['outputDir'])
 if not root.is_absolute():raise ValueError('Output directory must be absolute')
 root.mkdir(parents=True,exist_ok=True);state_path=root/'flow-run.json'
 if state_path.exists():
  state=json.loads(state_path.read_text())
  if state.get('planSha256')!=plan_sha:raise ValueError('Output directory belongs to another plan; do not reuse its state')
 else:state={'schema':'flow-run/v1','planSha256':plan_sha,'plan':str(Path(args.plan).resolve()),'inputs':{},'items':{},'events':[]}
 def save(phase,**detail):
  state['events'].append({'time':time.time(),'phase':phase,**detail});write_json(state_path,state)
 def item():
  group=plan['stills'] if args.kind=='still' else plan['shots']
  found=next((x for x in group if x['id']==args.item),None)
  if not found:raise ValueError('Choose an exact item ID and kind from the plan')
  return found
 phase=args.phase;aliases=aliases_for(plan,root)
 if phase in {'image','video','submit'}:
  review_path=Path(plan['source']['replicationPath']).parent/'revisao-producao.json'
  if review_path.exists():
   from flow_timing_review import validate_reviewed_plan
   validate_reviewed_plan(plan,json.loads(review_path.read_text()))
 if phase=='prepare':
  inputs=root/'inputs';prompts=root/'prompts';inputs.mkdir(exist_ok=True);prompts.mkdir(exist_ok=True)
  for asset in plan['assets']:
   target=Path(aliases[asset['id']]['path'])
   if target.exists() and sha(target)!=asset['sha256']:raise ValueError('Prepared input was changed: '+str(target))
   if not target.exists():shutil.copy2(asset['path'],target)
  for kind,group in [('still',plan['stills']),('shot',plan['shots'])]:
   for row in group:(prompts/(row['id']+'.'+kind+'.txt')).write_text(attachment_prompt(row,plan['assets'],aliases) if kind=='still' else row['prompt'])
  write_json(root/'anexos.json',aliases)
  target=root/'plano.json'
  if Path(args.plan).resolve()!=target.resolve():
   if target.exists() and sha(target)!=plan_sha:raise ValueError('Existing output plan differs; choose a new output directory')
   if not target.exists():shutil.copy2(args.plan,target)
  save('prepare');return {'phase':'prepared','state':str(state_path),'inputs':str(inputs),'prompts':str(prompts),'stills':len(plan['stills']),'shots':len(plan['shots']),'uiTouched':False}
 if phase in {'status','recover'}:
  for key,value in state['items'].items():
   if value.get('file') and (not Path(value['file']).exists() or sha(value['file'])!=value['sha256']):value['recoveryRequired']=True
  return {'state':str(state_path),'planSha256':plan_sha,'inputs':state['inputs'],'items':state['items'],'spentOrReservedCredits':sum(v.get('quotedCredits',0) for v in state['items'].values()),'note':'Submitted or uncertain items must be recovered from existing Flow media; never retry paid generation automatically.'}
 if phase=='record':
  row=item();file=Path(args.file or '')
  if not file.is_absolute() or not file.is_file():raise ValueError('Record an existing absolute output file only')
  previous=state['items'].get(row['id'],{})
  if args.asset_id:
   binding=getattr(args,'project',None) or state.get('project')
   if not binding:raise ValueError('Adopting a remote Flow asset requires its exact --project URL')
   binding=project_key(binding)
   if state.get('project') and state['project']!=binding:raise ValueError('Adopted asset belongs to another project')
   state['project']=binding
  quote=args.quote if args.quote is not None else previous.get('quotedCredits')
  if quote is None or not isinstance(quote,(int,float)) or not math.isfinite(quote) or quote<0:raise ValueError('Pass the known quote when adopting an existing output; missing is not zero')
  if previous.get('quotedCredits') is not None and previous['quotedCredits']!=quote:raise ValueError('Do not replace or reduce a previously reserved quote')
  other=sum(v.get('quotedCredits',0) for key,v in state['items'].items() if key!=row['id'])
  if other+quote>plan['settings']['maxCredits']:raise ValueError('Adopted outputs exceed the authorized cumulative plan maximum')
  state['items'][row['id']]={**previous,'quotedCredits':quote,'status':'available','kind':args.kind,'file':str(file),'sha256':sha(file),'assetId':args.asset_id,'pickerName':getattr(args,'picker_name',None),'promptSha256':hashlib.sha256(row['prompt'].encode()).hexdigest(),'humanApproved':bool(args.approved)}
  if args.kind=='shot' and not previous.get('qualityReview'):state['items'][row['id']]['qualityReview']={'identity':'pending','speech':'pending','voice':'pending' if row.get('speechMode','generated')=='generated' else 'not-applicable','music':'pending','voiceTimbreVerified':False}
  save('record',item=row['id']);return state['items'][row['id']]
 if phase not in {'inputs','image','video','submit'}:raise ValueError('Unsupported plan phase')
 if phase=='inputs':
  from flow_control import FlowControl
  flow=FlowControl()
  organize_plan(flow,plan)
  project=project_key(flow.js('location.href'))
  if state.get('project') and state['project']!=project:raise ValueError('Flow project changed; do not reuse remote references from another project')
  state['project']=project
  unique={a['sha256']:a for a in plan['assets']};missing=[a for digest,a in unique.items() if digest not in state['inputs']]
  if not missing:return {'phase':'inputs','reused':len(unique),'uploaded':0}
  paths=[aliases[a['id']]['path'] for a in missing]
  if any(not Path(path).exists() for path in paths):raise ValueError('Run prepare first to create unique hashed upload aliases')
  for asset in missing:
   if sha(aliases[asset['id']]['path'])!=asset['sha256']:raise ValueError('Prepared upload alias changed: '+asset['id'])
  flow.configure(plan['settings'],'still')
  result=flow.import_images(paths,dedupe=True,wait_seconds=20)
  for asset in missing:
   alias=aliases[asset['id']]
   if alias['name'] in result['imported']+result['already_present']:state['inputs'][asset['sha256']]={'name':alias['name'],'path':alias['path'],'project':project,'verified':'unique ref+hash alias validated locally and completed option observed'}
  save('inputs',complete=result['complete']);return result
 row=item();key=row['id'];current=state['items'].get(key,{})
 if current.get('status')=='available':
  if not Path(current['file']).exists() or sha(current['file'])!=current['sha256']:raise ValueError('Generated output needs recovery; do not resubmit')
  return {'reused':True,**current}
 if current.get('status') in {'submission_intent','submitted','uncertain'}:raise ValueError('This item was already submitted or may have been charged; recover existing media instead of generating again')
 from flow_control import FlowControl
 flow=FlowControl()
 organize_plan(flow,plan)
 project=project_key(flow.js('location.href'))
 if state.get('project') and state['project']!=project:raise ValueError('Flow project changed; recover in the recorded project before continuing')
 state['project']=project
 if phase in {'image','video'}:
  if (phase=='image')!=(args.kind=='still'):raise ValueError('Image uses kind still; video uses kind shot')
  if phase=='image':
   assets={a['id']:a for a in plan['assets']};references=[assets[i] for i in row['inputs']]
   if any(a['sha256'] not in state['inputs'] for a in references):raise ValueError('Run inputs once and verify completed cards before image preparation')
   names=[aliases[a['id']]['name'] for a in references]
  else:
   source=state['items'].get(row['still'],{})
   if source.get('status')!='available' or not source.get('assetId'):raise ValueError('Record the available still with its exact Flow asset ID before video preparation')
   if not source.get('file') or sha(source['file'])!=source.get('sha256'):raise ValueError('Selected local image changed; recover the recorded image before preparation')
   if not source.get('pickerName'):raise ValueError('Record the exact visible still picker name; do not guess it from the downloaded filename')
   if plan.get('selection',{}).get('videoRequiresSelectedCandidate'):
    proof_path=root/(row['still']+'.selection.json')
    if not proof_path.exists():raise ValueError('Three image candidates must be reviewed and one selected before video generation')
    proof=json.loads(proof_path.read_text())
    if proof.get('planSha256')!=plan_sha or proof.get('selectedAssetId')!=source['assetId'] or proof.get('status')!='selected' or len(proof.get('candidateAssetIds',[]))<3:raise ValueError('Image selection does not match the exact plan and recorded source image')

   from flow_organization import bind_collection_image
   image_name=Path(source['file']).name
   if plan['ref'] not in image_name:raise ValueError('Selected image filename must include its reference ID before collection binding')
   from flow_asset_registry import shared_lookup
   ident=plan.get('identity') or {}
   shared=shared_lookup(plan.get('organization',{}).get('projectUrl',project),plan['ref'],source['sha256'],{'expertSlug':ident.get('expertSlug'),'contactSheetSha256':ident.get('contactSheet',{}).get('sha256')})
   if shared:
    if source['assetId']!=shared['assetId'] or source['pickerName']!=shared['pickerName']:raise ValueError('Recorded source differs from explicit shared asset')
    image_binding={'assetId':shared['assetId'],'pickerName':shared['pickerName'],'sharedAsset':True}
   else:image_binding=bind_collection_image(flow,image_name,asset_id=source['assetId'])
   names=[image_binding['pickerName']]
   # Ingredients: identity images (expert contact sheet) ride along with the still.
   identity_bindings=[bind_collection_image(flow,Path(x).name) for x in (plan['settings'].get('identityImages',[]) if plan['settings'].get('videoMode')=='Ingredients' else [])]
   names+=[b['pickerName'] for b in identity_bindings]
  flow.key('Escape')
  if any(not n.get('ignored') and n.get('role',{}).get('value')=='button' and n.get('name',{}).get('value')=='Clear prompt' for n in flow.ax()):flow.click('button','Clear prompt')
  settings=flow.configure(plan['settings'],args.kind,row.get('duration'))
  prompt=attachment_prompt(row,plan['assets'],aliases) if phase=='image' else row['prompt']
  result=flow.fill_with_voice_mention(prompt,plan['settings']['voiceMention']) if phase=='video' and plan['settings'].get('voiceMention') else flow.fill(prompt,'[contenteditable="true"]')
  if not result['text_matches']:raise ValueError('Prompt did not read back literally; no submission allowed')
  reference_proofs=[]
  for name in names:
   flow.click('button','Add ingredients to the prompt box' if phase=='image' or plan['settings'].get('videoMode')=='Ingredients' else 'Start')
   flow.picker_option(name,frames=phase=='video')
   if phase=='video' and name==image_binding['pickerName']:reference_proofs.append({**image_binding,'localSha256':source['sha256']})
   elif phase=='video':reference_proofs.append({**next(b for b in identity_bindings if b['pickerName']==name),'role':'identity'})
  if phase=='video' and plan['settings'].get('voiceOption'):flow.attach_voice(plan['settings']['voiceOption'])
  expected_count=len(names)+(1 if phase=='video' and plan['settings'].get('voiceOption') else 0)
  composer=flow.composer_snapshot();deadline=time.monotonic()+10
  while (composer['prompt']!=prompt or len(composer['references'])!=expected_count) and time.monotonic()<deadline:
   time.sleep(.1);composer=flow.composer_snapshot()
  if composer['prompt']!=prompt or len(composer['references'])!=expected_count:
   write_json(root/(key+'.preparation-mismatch.json'),{'expectedPrompt':prompt,'actualPrompt':composer['prompt'],'expectedReferenceNames':names,'actualReferences':composer['references']})
   raise ValueError('Exact prompt/reference set cannot be verified; no submission allowed')
  audio_proof=validate_mentions(composer,{**plan['settings'],'audio':plan.get('audio')} if phase=='video' else {})
  if reference_proofs:validate_reference_proofs(composer,reference_proofs)
  state['items'][key]={'status':'prepared','kind':args.kind,'promptSha256':hashlib.sha256(prompt.encode()).hexdigest(),'referenceNames':names,'referenceSnapshot':composer['references'],'referenceProofs':reference_proofs,'duration':row.get('duration'),'settingsSnapshot':settings,'audioProof':audio_proof}
  save(phase,item=key);return {'phase':'prepared','item':key,'expectedSettings':{**plan['settings'],'duration':row.get('duration')},'note':'Inspect exact attached ingredients, model, preset, count and displayed quote. Preparation never submits.'}
 if phase=='submit':
  if current.get('status')!='prepared' or not args.acknowledge_spend:raise ValueError('Prepare the item and authorize the exact visible quote before submission')
  if args.quote is None or args.quote<0:raise ValueError('Pass the observed Flow quote; absence is not zero')
  spent=sum(v.get('quotedCredits',0) for k,v in state['items'].items() if k!=key)
  if spent+args.quote>plan['settings']['maxCredits']:raise ValueError('Cumulative quoted credits exceed the authorized plan maximum')
  composer=flow.composer_snapshot()
  audio_proof=validate_mentions(composer,{**plan['settings'],'audio':plan.get('audio')} if args.kind=='shot' else {})
  if hashlib.sha256(composer['prompt'].encode()).hexdigest()!=current.get('promptSha256') or composer['references']!=current.get('referenceSnapshot'):raise ValueError('Prompt or exact attached references changed after preparation; no submit')
  if current.get('referenceProofs'):validate_reference_proofs(composer,current['referenceProofs'])
  settings=flow.settings_snapshot()
  expected=['Image' if args.kind=='still' else 'Video',plan['settings']['aspectRatio'],'x'+str(plan['settings'].get('imageCount',1) if args.kind=='still' else 1)]
  # Flow (09/11/2026): Veo 3.1 não mostra seletor de duração nem de resolução (clipe fixo de 8 s).
  veo_fixo=args.kind=='shot' and model_key(plan['settings']['videoModel']).startswith('veo') and not any(re.fullmatch(r'\d+s',l) for l in settings['checked'])
  if veo_fixo and int(row['duration'])!=8:raise ValueError('Veo sem seletor de duração gera 8 s; o plano pediu '+str(row['duration'])+' s')
  if args.kind=='shot':expected+=[plan['settings'].get('videoMode','Frames')]+([] if veo_fixo else [str(row['duration'])+'s'])
  if not all(label in settings['checked'] for label in expected):raise ValueError('Checked mode/aspect/duration/count differ from the plan')
  if args.kind=='shot' and not veo_fixo and not (any(label==plan['settings']['resolution'] or label.startswith(plan['settings']['resolution']+' ') for label in settings['checked']) or settings.get('resolution')==plan['settings']['resolution']):raise ValueError('Checked resolution differs from plan')
  model=plan['settings']['imageModel'] if args.kind=='still' else plan['settings']['videoModel']
  caption=model_key(settings['model']);wanted=model_key(model)
  if wanted!=caption or settings['quote']!=args.quote:raise ValueError('Selected model or observed quote differs from prepared/requested settings')
  if not args.submit_name or args.submit_name!='Start generation':raise ValueError('Use the exact Start generation control')
  if getattr(args,'check_only',False):return {'item':key,'status':'ready','willSubmit':False,'quote':args.quote,'remainingBudget':plan['settings']['maxCredits']-spent,'promptAndReferencesMatch':True,'settingsMatch':True,'referenceProofs':current.get('referenceProofs',[]),'voiceMentions':composer.get('mentions',[]),**audio_proof}
  state['items'][key]={**current,'status':'submission_intent','quotedCredits':args.quote,'audioProof':audio_proof};save('submission_intent',item=key)
  try:result=flow.click('button',args.submit_name,True)
  except Exception:state['items'][key]['status']='uncertain';save('submission_uncertain',item=key);raise
  deadline=time.monotonic()+5
  while flow.composer_snapshot()['prompt'].strip() and time.monotonic()<deadline:time.sleep(.15)
  if flow.composer_snapshot()['prompt'].strip():
   state['items'][key]['status']='uncertain';save('submission_not_acknowledged',item=key,reason='Composer retained prompt after click; generation not confirmed')
   raise RuntimeError('Flow did not acknowledge submission; recover existing media before any retry')
  state['items'][key]['submissionEvidence']='Composer cleared after exact generation control click; rendered output still requires collection'
  state['items'][key]['status']='submitted';save('submitted',item=key);return {'item':key,'status':'submitted','quotedCredits':args.quote,'result':result,'note':'Continue with the next independent item; collect existing media separately.'}
 raise ValueError('Unsupported plan phase')
