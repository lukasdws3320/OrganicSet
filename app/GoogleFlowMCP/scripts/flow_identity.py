"""Offline production contract. Shared source frames never identify a character."""
import hashlib,json,re
from pathlib import Path

# Renomes cadastrais conhecidos (01/11/2026); a prova de bytes da fonte fica em flow_plan.renamed_source_matches.
RENAMED_SLUGS={'cozinheiras-da-vovo-loira':'mini-chefs-da-vovo-loira','cozinheiras-da-vovo-morena':'mini-chefs-da-vovo-morena'}
def same_slug(current,planned):return current==planned or RENAMED_SLUGS.get(planned)==current
def fingerprint(value):
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def validate_audio(audio,settings,shots):
 if audio is None:return
 if audio.get('mode') not in {'generated','post-production','silent'} or audio.get('voiceBinding') not in {'required','best-effort','none'} or not isinstance(audio.get('allowInvalidMention'),bool):
  raise ValueError('Explicit audio mode, voiceBinding and allowInvalidMention are required')
 has_voice=bool(settings.get('voiceMention') or settings.get('voiceOption'))
 generated=any(s.get('speechMode','generated')=='generated' and s.get('speech','').strip() for s in shots)
 if audio['mode']!='generated' and (generated or has_voice):raise ValueError('Silent/post-production audio cannot request generated speech or a Flow voice')
 if generated and audio['mode']!='generated':raise ValueError('Generated speech disagrees with audio policy')
 if audio['voiceBinding']=='required' and (not has_voice or audio['allowInvalidMention']):raise ValueError('Required voice binding needs an explicit voice and disallows invalid mentions')
 if audio['voiceBinding']=='none' and has_voice:raise ValueError('Voice selection disagrees with audio policy')

def validate_contract(plan,strict=False):
 """Validate semantic links as well as hashes; strict is required for multi-character batches."""
 from flow_plan import sha
 source=plan['source'];identity=plan.get('identity');settings=plan['settings'];organization=plan.get('organization',{})
 if strict and (not identity or not source.get('expertProfilePath') or not source.get('selectedImagesPath') or not plan.get('audio')):
  raise ValueError('Batch requires identity, expert profile, selected-image manifest and explicit audio policy; legacy plans remain individual')
 if strict and not Path(plan['outputDir']).is_absolute():raise ValueError('Use an absolute output directory for each production job')
 rep=json.loads(Path(source['replicationPath']).read_text())
 if identity:
  if not re.fullmatch(r'[a-z0-9-]+',identity.get('expertSlug','')):raise ValueError('Invalid character slug')
  if (rep.get('expert'),rep.get('avatar'),rep.get('ref'))!=(plan.get('expert'),identity.get('avatarName'),plan['ref']) or not same_slug(rep.get('slug'),identity.get('expertSlug')):
   raise ValueError('Plan identity differs from replication expert/avatar/reference')
  sheet=identity.get('contactSheet',{})
  if not Path(sheet.get('path','')).is_absolute() or sha(sheet['path'])!=sheet.get('sha256'):raise ValueError('Expert contact sheet changed')
 profile_path=source.get('expertProfilePath')
 if profile_path:
  profile=json.loads(Path(profile_path).read_text());flow=profile.get('flow',{})
  if not identity or profile.get('schema')!='expert-flow-profile/v1' or (profile.get('expertName'),profile.get('avatarName'))!=(plan.get('expert'),identity.get('avatarName')) or not same_slug(profile.get('expertSlug'),identity.get('expertSlug')):
   raise ValueError('Expert profile identity differs from plan')
  contact=profile.get('contactSheet',{})
  if contact.get('sha256')!=identity['contactSheet']['sha256'] or Path(contact.get('path','')).resolve()!=Path(identity['contactSheet']['path']).resolve():
   raise ValueError('Expert profile contact sheet differs from plan')
  if organization.get('expertProjectName')!=flow.get('projectName') or organization.get('projectUrl')!=flow.get('projectUrl') or organization.get('collectionName')!=plan['ref']:
   raise ValueError('Expert profile project/collection differs from plan')
  # Optional voice fields must also compare absence: no inherited voice from a previous expert.
  for key in (set(flow)-{'projectName','projectUrl'})|{'voiceMention','voiceOption','identityImages','voiceInFramesTest'}:
   if settings.get(key)!=flow.get(key):raise ValueError('Expert profile setting differs from plan: '+key)
  if profile.get('audio')!=plan.get('audio'):raise ValueError('Expert profile audio policy differs from plan')
 validate_audio(plan.get('audio'),settings,plan.get('shots',[]))
 selected_path=source.get('selectedImagesPath')
 if selected_path:
  selected=json.loads(Path(selected_path).read_text())
  if not identity or selected.get('schema')!='flow-selected-images/v1' or (selected.get('ref'),selected.get('expertSlug'),selected.get('avatarName'),selected.get('contactSheetSha256'))!=(plan['ref'],identity.get('expertSlug'),identity.get('avatarName'),identity['contactSheet']['sha256']):
   raise ValueError('Selected image identity differs from plan')
  rows={r['still']:r for r in selected['images']}
  if len(rows)!=len(selected['images']):raise ValueError('Selected image IDs must be unique')
  used={s['still'] for s in plan['shots']}
  for still in plan['stills']:
   if still['id'] not in used:continue
   row=rows.get(still['id'])
   # Production still IDs are not analysis IDs: bind by the declared take+frame, which must exist in the analysis
   # and, when the still used analysis frames as inputs, must be one of those inputs.
   original=next((s for s in rep.get('stills',[]) if row and (s.get('take'),s.get('frame_sha256'))==(row.get('referenceTake'),row.get('referenceFrameSha256'))),None) if row else None
   frame_hashes={s.get('frame_sha256') for s in rep.get('stills',[])}
   used_frames={a['sha256'] for a in plan['assets'] if a['id'] in still.get('inputs',[]) and a['sha256'] in frame_hashes}
   if row and used_frames and row.get('referenceFrameSha256') not in used_frames:raise ValueError('Selected image source take/frame differs from replication')
   if not row or row.get('selected') is not True or Path(row['path']).resolve()!=Path(still['output']).resolve() or sha(row['path'])!=row.get('sha256'):
    raise ValueError('Selected image file/hash differs from plan: '+still['id'])
   if not any(a['sha256']==row['sha256'] and Path(a['path']).resolve()==Path(row['path']).resolve() for a in plan['assets']):
    raise ValueError('Selected image is not a pinned plan asset')
   if (strict or row.get('referenceTake') or row.get('referenceFrameSha256')) and not original:
    raise ValueError('Selected image source take/frame differs from replication')
  if strict:
   for shot in plan['shots']:
    if not Path(shot['output']).resolve().is_relative_to(Path(plan['outputDir']).resolve()):raise ValueError('Shot output escapes its own run directory')
 if strict and settings.get('voiceMention') and any(not s['prompt'].startswith(settings['voiceMention']['display']+' ') for s in plan['shots']):
  raise ValueError('Literal prompt must carry this character voice mention prefix')
 scope={'expertSlug':(identity or {}).get('expertSlug',rep.get('slug')),'avatarName':(identity or {}).get('avatarName',rep.get('avatar')),'reference':plan['ref'],'version':plan.get('version'),'contactSheetSha256':(identity or {}).get('contactSheet',{}).get('sha256'),'projectUrl':organization.get('projectUrl'),'voiceMention':settings.get('voiceMention'),'voiceOption':settings.get('voiceOption'),'audio':plan.get('audio')}
 return {**scope,'jobKey':fingerprint(scope),'identityContractVerified':bool(identity and profile_path and selected_path),'voiceTimbreVerified':False,'audioPolicy':plan.get('audio') or {'status':'legacy-unspecified'}}
