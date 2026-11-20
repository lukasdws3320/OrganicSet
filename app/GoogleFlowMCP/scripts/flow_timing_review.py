"""Apply an explicit editorial timing/continuity review to a local Flow plan."""
from copy import deepcopy

def apply_timing_review(plan, review):
    if review.get('ref') != plan['ref'] or review.get('authorizedByUser') is not True:
        raise ValueError('Review must bind the exact reference and human authorization')
    result = deepcopy(plan)
    source = plan['shots']
    by_id = {s['id']: s for s in source}
    used = set()
    replacements = {}
    for group in review['groups']:
        ids = group['sourceShots']
        if not ids or any(i not in by_id or i in used for i in ids):
            raise ValueError('Unknown or overlapping reviewed shots')
        positions = [source.index(by_id[i]) for i in ids]
        if positions != list(range(positions[0], positions[0] + len(ids))):
            raise ValueError('Reviewed shots must be contiguous and ordered')
        if group['duration'] not in (4, 6, 8) or not group.get('reason'):
            raise ValueError('Review needs a valid Veo duration and editorial reason')
        rows = [by_id[i] for i in ids]
        if any(abs(a['sourceWindow'][1]-b['sourceWindow'][0]) > .03 for a,b in zip(rows,rows[1:])):
            raise ValueError('Reviewed source windows are not continuous')
        row = deepcopy(rows[0])
        speech = ' '.join(s['speech'] for s in rows if s['speech'].strip())
        spoken = ' '.join(s.get('spokenSpeech', s['speech']) for s in rows if s['speech'].strip())
        previous_spoken = row.get('spokenSpeech', row['speech'])
        if row['prompt'].count(previous_spoken) != 1:
            raise ValueError('Literal dialogue is ambiguous in prompt')
        row['prompt'] = row['prompt'].replace(previous_spoken, spoken)
        if len(rows)>1:
            if not group.get('actionDirection') or not group.get('sourceTakes'):
                raise ValueError('Merged generation requires reviewed actions and take mapping')
            row['prompt'] += ' ' + group['actionDirection']
        row.update(speech=speech, spokenSpeech=spoken, speechEstimate=len(speech.split())/3.2,
                   sourceWindow=[rows[0]['sourceWindow'][0],rows[-1]['sourceWindow'][1]],
                   sourceDuration=round(rows[-1]['sourceWindow'][1]-rows[0]['sourceWindow'][0],6),
                   requestedDuration=group['duration'],duration=group['duration'],
                   durationReason=group['reason'],sourceShots=ids,
                   sourceTakes=group.get('sourceTakes',[]),
                   durationOverride={'authorizedByUser':True,'reason':group['reason']})
        replacements[ids[0]]=row
        used.update(ids)
    result['shots']=[replacements[s['id']] if s['id'] in replacements else deepcopy(s)
                     for s in source if s['id'] not in used or s['id'] in replacements]
    result['timingReview']=deepcopy(review)
    return result

def validate_reviewed_plan(plan, review):
    """Reject stale paid preparation; historical status/downloads remain readable."""
    if review.get('ref') != plan['ref'] or review.get('authorizedByUser') is not True:
        raise ValueError('Invalid production timing review')
    for group in review['groups']:
        affected = [s for s in plan['shots'] if set(s.get('sourceShots',[s['id']])) & set(group['sourceShots'])]
        if not affected:
            continue
        if len(affected)!=1:
            raise ValueError('Reviewed continuous speech is split into multiple generations')
        row=affected[0]
        if row['id']!=group['sourceShots'][0] or row.get('sourceShots',[row['id']])!=group['sourceShots']:
            raise ValueError('Generation does not preserve reviewed source shots')
        if row['duration']!=group['duration']:
            raise ValueError('Generation uses duration superseded by human review')
        if len(group['sourceShots'])>1 and row.get('sourceTakes')!=group.get('sourceTakes'):
            raise ValueError('Merged generation lost reviewed visual takes')
