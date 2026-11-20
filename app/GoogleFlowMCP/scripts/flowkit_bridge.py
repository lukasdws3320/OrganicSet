"""Additive FlowKit adapter: read-only health and offline plan export. No submit/retry."""
import argparse
import json
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

UPSTREAM = 'https://github.com/crisng95/flowkit'
REVISION = 'b09e783481d20bfeaf46f2fbcde08bf2b54c0a2a'


def local_base(value):
    parsed = urlparse(value)
    if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'}
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {'', '/'}):
        raise ValueError('Use a loopback HTTP service base URL without credentials or path')
    return value.rstrip('/')


def health(base, get=None):
    base = local_base(base)
    def fetch(path):
        with urlopen(Request(base + path, method='GET'), timeout=3) as response:
            return json.load(response)
    get = get or fetch
    result = {'baseUrl': base, 'ready': False, 'generationSubmitted': False}
    try:
        service, flow = get('/health'), get('/api/flow/status')
        # Explicit allowlist: never return raw bridge/auth payloads.
        result.update(service=service.get('status'), extensionConnected=service.get('extension_connected') is True,
                      connected=flow.get('connected') is True, authenticated=flow.get('authenticated') is True,
                      transport=flow.get('transport') if flow.get('transport') in {'batch', 'legacy'} else 'unknown')
        result['ready'] = all([result['service'] == 'ok', result['extensionConnected'],
                               result['connected'], result['authenticated'], result['transport'] == 'batch'])
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        result['error'] = type(exc).__name__
    return result


def export_plan(plan, plan_sha, state):
    from flow_plan import model_key, project_key
    if model_key(plan['settings']['videoModel']) != 'omni1.1flash':
        raise ValueError('This adapter exports Omni 1.1 Flash only')
    if state.get('planSha256') != plan_sha:
        raise ValueError('State belongs to a different plan')
    project = project_key(state['project'])
    project_id = project.rsplit('/', 1)[1]
    settings = plan['settings']
    aspect = {'9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT', '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE'}[settings['aspectRatio']]
    voice_required = bool(plan.get('voice', {}).get('required') or settings.get('voiceOption'))
    jobs = []
    for shot in plan['shots']:
        source = state.get('items', {}).get(shot['still'], {})
        prior = state.get('items', {}).get(shot['id'], {})
        blockers = []
        if voice_required:
            blockers.append('Voice reference is not supported by the inspected FlowKit video contract')
        if not source.get('assetId'):
            blockers.append('Adopt the exact uploaded Flow media ID; filenames are not media IDs')
        if source.get('assetId') and not source.get('pickerName'):
            blockers.append('Missing evidence of selected source image')
        if prior.get('status') in {'submitted', 'submission_intent', 'uncertain', 'available'}:
            blockers.append('Recover existing video; do not submit again')
        payload = dict(prompt=shot['prompt'], project_id=project_id,
                       scene_id=plan['ref'] + '__' + shot['id'], duration_s=shot['duration'],
                       resolution=settings['resolution'], aspect_ratio=aspect)
        if settings.get('videoMode', 'Frames') == 'Ingredients':
            endpoint = '/api/flow/generate-video-omni'
            payload['reference_media_ids'] = [source['assetId']] if source.get('assetId') else []
        else:
            endpoint = '/api/flow/generate-video'
            payload.update(model_family='omni_flash', start_image_media_id=source.get('assetId'))
        jobs.append(dict(id=shot['id'], endpoint=endpoint, payload=payload, blockers=blockers))
    return dict(schema='flowkit-offline-export/v1', upstream=UPSTREAM, revision=REVISION,
                planSha256=plan_sha, project=project, maxCredits=settings['maxCredits'],
                submitted=False, jobs=jobs,
                execution='Offline only. Live quote, budget and durable submission receipt required before execution.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    doctor = sub.add_parser('doctor'); doctor.add_argument('--base-url', default='http://127.0.0.1:8100')
    export = sub.add_parser('export'); export.add_argument('--plan', required=True)
    export.add_argument('--state', required=True); export.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.command == 'doctor':
        result = health(args.base_url)
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0 if result['ready'] else 1
    from flow_plan import load_plan
    plan, digest = load_plan(args.plan)
    result = export_plan(plan, digest, json.loads(Path(args.state).read_text()))
    # Exclusive create: preserve existing plans and the production state.
    with Path(args.output).open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps({'output': str(Path(args.output).resolve()), 'jobs': len(result['jobs']), 'submitted': False}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
