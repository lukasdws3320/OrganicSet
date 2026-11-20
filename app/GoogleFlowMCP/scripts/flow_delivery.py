"""Offline delivery/review evidence. Text labels never approve a media version."""
import json,re
from datetime import datetime
from pathlib import Path
from flow_plan import sha,write_json

def review_matches(review,shot,digest):
 if not isinstance(review,dict):return False
 try:
  date=datetime.fromisoformat(review.get('reviewedAt','').replace('Z','+00:00'))
  if date.tzinfo is None:return False
 except (ValueError,TypeError,AttributeError):return False
 return (review.get('schema')=='flow-clip-review/v1' and review.get('shot')==shot
         and review.get('sha256')==digest and review.get('status')=='approved'
         and review.get('audioReviewed') is True and review.get('visualReviewed') is True
         and isinstance(review.get('reviewer'),dict) and isinstance(review['reviewer'].get('model'),str) and bool(review['reviewer']['model'].strip()))

def audit_delivery(manifest_file):
 file=Path(manifest_file).resolve();manifest=json.loads(file.read_text())
 clips=manifest.get('clips',[])
 if not isinstance(clips,list) or not clips:raise ValueError('Delivery must contain clips')
 seen=set();missing=[];pending=[];changed=[];reviewed=[]
 for clip in clips:
  shot=clip.get('shot')
  if not isinstance(shot,str) or not re.fullmatch(r'SHOT\d+',shot) or shot in seen:raise ValueError('Invalid or duplicate delivery shot')
  seen.add(shot)
  path=(file.parent/clip.get('file','')).resolve()
  if not path.is_file():missing.append(shot);pending.append(shot);continue
  digest=sha(path)
  if digest!=clip.get('sha256'):changed.append(shot);pending.append(shot);continue
  if review_matches(clip.get('review'),shot,digest):reviewed.append(shot)
  else:pending.append(shot)
 expected=manifest.get('expectedShots');coverage=isinstance(expected,list) and bool(expected) and len(set(expected))==len(expected) and set(expected)==seen
 return {'schema':'flow-delivery-audit/v1','ref':manifest.get('ref'),'expertSlug':manifest.get('expertSlug'),
         'clips':len(clips),'downloaded':len(clips)-len(missing),'reviewed':reviewed,'reviewPending':pending,
         'missing':missing,'changed':changed,'qualityApproved':not pending,'coverageVerified':coverage,'complete':not pending and coverage,'humanApproved':False,
         'generationSubmitted':False,'uiTouched':False}

def build_delivery(selection_file,output):
 source=Path(selection_file).resolve();target=Path(output).resolve()
 if target.exists():raise FileExistsError('Preserve existing delivery; choose a new version directory')
 data=json.loads(source.read_text());clips=data.get('clips',[])
 if not clips:raise ValueError('Selection must contain clips')
 for clip in clips:
  path=(source.parent/clip['file']).resolve()
  if not path.is_file():raise ValueError('Selected clip is missing')
  digest=sha(path)
  if clip.get('sha256') and clip['sha256']!=digest:raise ValueError('Selected clip changed before delivery')
  clip.update(file=str(path),sha256=digest)
 # A historical prose label is retained only as context, never as the review summary.
 if 'revisao' in data:data['legacyReviewClaim']=data.pop('revisao')
 data['schema']='flow-delivery/v1';target.parent.mkdir(parents=True,exist_ok=True)
 with target.open('x') as handle:handle.write(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 try:
  audit=audit_delivery(target)
  data['reviewSummary']={k:audit[k] for k in ('qualityApproved','complete','coverageVerified','reviewPending')};write_json(target,data)
  return {'path':str(target),**audit}
 except Exception:
  target.unlink();raise
