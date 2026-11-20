#!/usr/bin/env python3
"""Sequential queues over sibling flow_plan/flow_control modules; no browser connection or paid retry."""
import argparse
import fcntl
import json
import math
import sys
import time
from pathlib import Path
from types import SimpleNamespace

PROTECTED = {'available', 'submitted', 'submission_intent', 'uncertain', 'blocked', 'failed'}
RENDER_ERRORS = (
    'Exact prompt/reference set cannot be verified',
    'Prompt did not read back literally',
    'Textbox missing or ambiguous',
    'Control has no DOM node',
    'Exact control is missing or ambiguous',
)


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def close_editor(flow):
    if '/edit/' not in flow.js('location.href'):
        return
    names = {n.get('name', {}).get('value', '') for n in flow.ax()
             if not n.get('ignored') and n.get('role', {}).get('value') == 'button'}
    button = 'Done editing scene' if 'Done editing scene' in names else 'Done editing' if 'Done editing' in names else None
    if not button:
        raise RuntimeError('Current editor has neither observed close control; no queue item prepared')
    flow.click('button', button)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if '/edit/' not in flow.js('location.href'):
            return
        time.sleep(.1)
    raise RuntimeError('Editor did not return to the project grid; queue stopped before submission')


def queue(args):
    # Installed next to these existing modules. No machine path, /tmp path, WebSocket or daemon start.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from flow_plan import load_plan, run_plan
    from flow_control import FlowControl
    path = str(Path(args.plan).resolve())
    plan, _ = load_plan(path)
    kind = 'still' if args.command == 'queue-images' else 'shot'
    rows = plan['stills' if kind == 'still' else 'shots']

    def run(phase, row=None, quote=None):
        return run_plan(SimpleNamespace(
            plan=path, phase=phase, kind=kind, item=row['id'] if row else None,
            file=None, asset_id=None, picker_name=None, project=None, quote=quote,
            submit_name='Start generation', acknowledge_spend=True, approved=False, check_only=False,
        ))

    run('prepare')
    state = run('status')
    pending = [row for row in rows if state['items'].get(row['id'], {}).get('status') not in PROTECTED]
    skipped = []
    for row in rows:
        current = state['items'].get(row['id'], {})
        if current.get('status') in PROTECTED:
            skipped.append(row['id'])
            emit({'ref': plan['ref'], 'item': row['id'], 'action': 'skip',
                  'status': current['status'], 'recoveryRequired': bool(current.get('recoveryRequired')),
                  'note': 'Recover existing output when submitted/uncertain/missing; no generation retried.'})
    if not pending:
        return {'ref': plan['ref'], 'kind': kind, 'submitted': [], 'skipped': skipped, 'uiTouched': False}
    flow = FlowControl()
    if kind == 'still' and args.inputs:
        close_editor(flow)
        flow.cdp('Page.setInterceptFileChooserDialog', enabled=True)
        imported = run('inputs')
        emit({'ref': plan['ref'], 'phase': 'inputs', **imported})
        if not imported.get('complete', True):
            raise RuntimeError('Inputs still uploading; no generation sent. Rerun to recover/import only missing inputs.')
    submitted = []
    for row in pending:
        current = run('status')['items'].get(row['id'], {})
        if current.get('status') in PROTECTED:
            skipped.append(row['id'])
            emit({'ref': plan['ref'], 'item': row['id'], 'action': 'skip', 'status': current['status']})
            continue
        close_editor(flow)
        phase = 'image' if kind == 'still' else 'video'
        for attempt in range(2):
            try:
                run(phase, row)
                break
            except (ValueError, RuntimeError) as error:
                safe_render_error = any(message in str(error) for message in RENDER_ERRORS)
                after = run('status')['items'].get(row['id'], {})
                if attempt != 0 or not safe_render_error or after.get('status') in PROTECTED:
                    raise
                emit({'ref': plan['ref'], 'item': row['id'], 'phase': 'preparation_retry',
                      'attempt': 1, 'reason': str(error), 'generationSubmitted': False})
                time.sleep(.3)
                close_editor(flow)
                flow.key('Escape')
        prepared = run('status')['items'].get(row['id'], {})
        if prepared.get('status') != 'prepared':
            raise RuntimeError('Preparation did not leave the exact planned item ready; no submission')
        # The quote comes from Flow's preparation snapshot, not a hardcoded price/preset table.
        quote = prepared.get('settingsSnapshot', {}).get('quote')
        if isinstance(quote, bool) or not isinstance(quote, (int, float)) or not math.isfinite(quote) or quote < 0:
            raise ValueError('Preparation has no finite observed Flow quote; no submission')
        if kind == 'still' and quote != 0:
            raise ValueError('Image queue requires the observed zero-credit quote; no paid image submitted')
        # flow_plan rechecks exact references, literal prompt, model, mode, count, preset,
        # resolution, selection proof and cumulative plan maximum before its one paid click.
        # This call is deliberately outside the preparation retry block.
        result = run('submit', row, quote)
        submitted.append(row['id'])
        emit({'ref': plan['ref'], 'item': row['id'], 'phase': 'submitted',
              'status': result['status'], 'quote': quote, 'duration': row.get('duration'),
              'outputCount': plan['settings'].get('imageCount', 1) if kind == 'still' else 1})
    return {'ref': plan['ref'], 'kind': kind, 'submitted': submitted, 'skipped': skipped,
            'note': 'Queue submission only. Collect existing outputs separately; generation was never retried.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    image = commands.add_parser('queue-images', help='Queue free image jobs from one pinned plan')
    image.add_argument('plan'); image.add_argument('--inputs', action='store_true', help='Import missing planned input aliases before preparing images')
    video = commands.add_parser('queue-videos', help='Queue selected-image video jobs from one pinned plan')
    video.add_argument('plan'); video.set_defaults(inputs=False)
    args = parser.parse_args(argv)
    lock = Path.home() / '.config/google-flow-mcp/state/control-operation.lock'
    if not lock.parent.is_dir():
        raise RuntimeError('Existing Flow Control state directory is missing; set up the configured Harness first')
    with lock.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another Flow executor owns the UI; no action retried')
        try:
            emit(queue(args))
            return 0
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        emit({'error': str(error), 'generationRetried': False,
              'recovery': 'Read flow-run.json/status and recover submitted or uncertain media; do not reset/requeue it.'})
        raise SystemExit(1)
