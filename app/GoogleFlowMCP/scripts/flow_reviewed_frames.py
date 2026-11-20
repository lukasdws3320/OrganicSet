"""Build an expert-owned Frames plan from explicit cadence and selected-image data."""
import argparse,json
from pathlib import Path
from flow_plan import sha,write_json,load_plan
from flow_timing_review import apply_timing_review,validate_reviewed_plan

def build(base_file,spec_file,images_file):
 base_file=Path(base_file).resolve();base,_=load_plan(base_file);spec=json.loads(Path(spec_file).read_text())
 selected=json.loads(Path(images_file).read_text());identity=base.get('identity',{})
 if selected.get('schema')!='flow-selected-images/v1':raise ValueError('Unsupported selected-image manifest')
 if spec.get('authorizedByUser') is not True:raise ValueError('Cadence review must belong to the authorized production task')
 if spec.get('ref')!=base['ref'] or spec.get('expertSlug')!=identity.get('expertSlug'):
  raise ValueError('Cadence review belongs to another reference/expert')
 if selected.get('ref')!=base['ref'] or selected.get('expertSlug')!=identity.get('expertSlug') or selected.get('avatarName')!=identity.get('avatarName'):
  raise ValueError('Selected images belong to another reference/expert/avatar')
 if selected.get('contactSheetSha256')!=identity.get('contactSheet',{}).get('sha256'):
  raise ValueError('Selected images do not bind this expert contact sheet')
 if base['settings'].get('videoMode')!='Frames':raise ValueError('Use an explicitly configured Frames profile for this builder')
 target=base_file.parent/'plano.json'
 if target.exists():raise FileExistsError('Preserve the current plan and state; choose a new run directory')
 replica=Path(base['source']['replicationPath']).parent
 replication=json.loads(Path(base['source']['replicationPath']).read_text())
 source_stills={s['id']:s for s in replication.get('stills',[])}
 raw=json.loads((replica.parent/'shots.json').read_text())
 takes={s['id']:[t['id'] for t in s['takes']] for s in raw['shots']}
 def mapped(group):return {**group,'sourceTakes':[take for s in group['sourceShots'] for take in takes[s]]}
 groups=[mapped(g) for g in spec['groups']];post=[mapped(g) for g in spec.get('postProduction',[])]
 covered=[s for g in groups+post for s in g['sourceShots']]
 if sorted(covered)!=sorted(s['id'] for s in base['shots']) or len(covered)!=len(set(covered)):
  raise ValueError('Every reference fragment must appear once in generation or post-production')
 review={'ref':base['ref'],'authorizedByUser':True,'reviewedAt':spec['reviewedAt'],'voicePace':spec['voicePace'],'groups':groups,'postProduction':post}
 plan=apply_timing_review(base,review)
 post_ids={s for g in post for s in g['sourceShots']}
 plan['shots']=[s for s in plan['shots'] if s['id'] not in post_ids]
 rows={row['still']:row for row in selected['images']};assets=[];stills=[]
 if len(rows)!=len(selected['images']):raise ValueError('Duplicate selected-image IDs are ambiguous')
 for still_id in dict.fromkeys(s['still'] for s in plan['shots']):
  row=rows.get(still_id)
  if not row or row.get('selected') is not True:raise ValueError('Missing selected image: '+still_id)
  source=source_stills.get(still_id)
  if source and (row.get('referenceTake')!=source.get('take') or row.get('referenceFrameSha256')!=source.get('frame_sha256')):
   raise ValueError('Selected image does not bind the expected reference take/frame: '+still_id)
  image=Path(row['path']).resolve()
  if not image.is_file() or sha(image)!=row['sha256']:raise ValueError('Selected image hash changed: '+still_id)
  if base['ref'] not in image.name:raise ValueError('Selected image filename must include its own reference')
  asset_id=still_id+'-selected'
  assets.append({'id':asset_id,'path':str(image),'sha256':row['sha256'],'name':image.name,'role':'imagem inicial selecionada'})
  stills.append({'id':still_id,'prompt':'Imagem inicial selecionada; reutilizar o arquivo existente.','inputs':[asset_id],'output':str(image)})
 plan['assets']=assets;plan['stills']=stills;plan['outputDir']=str(base_file.parent)
 for shot in plan['shots']:
  mention=plan['settings'].get('voiceMention')
  if mention and not shot['prompt'].startswith(mention['display']+' '):shot['prompt']=mention['display']+' '+shot['prompt']
  shot['output']=str(base_file.parent/(shot['id']+'.shot.mp4'))
 plan['selection']={'videoRequiresSelectedCandidate':False,'reason':'Imagens iniciais selecionadas no manifesto deste expert/avatar/referência.'}
 plan['source'].update(selectedImagesPath=str(Path(images_file).resolve()),selectedImagesSha256=sha(images_file))
 validate_reviewed_plan(plan,review)
 write_json(target,plan)
 try:load_plan(target)
 except Exception:
  target.unlink();raise
 review_file=replica/'revisao-producao.json'
 if review_file.exists():
  history=replica/'historico';history.mkdir(exist_ok=True)
  (history/('revisao-producao-'+sha(review_file)[:16]+'.json')).write_bytes(review_file.read_bytes())
 write_json(review_file,review)
 return {'plan':str(target),'ref':plan['ref'],'expert':plan['expert'],'generations':len(plan['shots']),'generated':False}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--base',required=True);parser.add_argument('--review',required=True);parser.add_argument('--images',required=True)
 args=parser.parse_args();print(json.dumps(build(args.base,args.review,args.images),ensure_ascii=False))
