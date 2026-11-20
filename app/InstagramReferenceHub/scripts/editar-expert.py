#!/usr/bin/env python3
"""Edição de apresentador pela fila do Hub: corta sobras pela fala medida, cortes em L e legenda ASS.
Uso: editar-expert.py REPLICACAO_DIR PASTA_DESTINO NOME_DO_ARQUIVO.mp4. Promovido do montar.py da REF-0236 (02/11/2026)."""
import glob, json, math, re, subprocess, sys, unicodedata
from difflib import SequenceMatcher
from pathlib import Path

REP, DEST, NAME = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), sys.argv[3]
workflow = json.loads((REP / 'producao-workflow.json').read_text())
HERE = REP / 'producao' / workflow['runId'] / 'edicao'
PROJECT = Path(__file__).resolve().parents[2] / 'GoogleFlowMCP'
import shutil
FFMPEG = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' if Path('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg').exists() else (shutil.which('ffmpeg') or 'ffmpeg')
LIBRARY = PROJECT / 'vendor/ffmpeg-word-captions'
TRANSCREVER = str(Path(__file__).resolve().parents[3] / '.claude/skills/transcricao-assemblyai/scripts/transcrever.py')
DEST.mkdir(parents=True, exist_ok=True)
OUTPUT = DEST / NAME

def norm(t):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower())

fps = 24
clips = []
caption_words = []
offset = 0.0
manifesto = json.loads((HERE / 'manifesto.json').read_text())
(HERE / 'asr-clipes').mkdir(exist_ok=True)
for clip in manifesto['clips']:
    shot = {'id': clip['id'], 'speech': clip['source']['speech']}
    source = Path(clip['path'])
    cache = HERE / 'asr-clipes' / (source.stem + '-' + clip['sha256'][:12] + '.json')
    if not cache.exists():
        subprocess.run(['python3', TRANSCREVER, str(source), '--out', str(HERE / 'asr-clipes' / clip['id']), '--lang', 'pt'], check=True, stdout=subprocess.DEVNULL)
        cache.write_text((HERE / 'asr-clipes' / clip['id'] / (source.stem + '.json')).read_text())
    asr = json.loads(cache.read_text())
    actual = asr['words']
    expected = [norm(w) for w in shot['speech'].split()]
    spoken = [norm(w['text']) for w in actual]
    matcher = SequenceMatcher(None, expected, spoken, autojunk=False)
    matches = {i + k: j + k for i, j, count in matcher.get_matching_blocks() for k in range(count)}
    if matcher.ratio() < .88 or 0 not in matches or len(expected) - 1 not in matches:
        raise ValueError(f"Conferir fala antes de cortar: {shot['id']}: {asr['text']}")
    words = actual[matches[0]:matches[len(expected) - 1] + 1]
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,r_frame_rate', '-of', 'json', str(source)]))
    duration = float(probe['format']['duration'])
    rate = next(s['r_frame_rate'] for s in probe['streams'] if s['codec_type'] == 'video')
    if rate != '24/1':
        raise ValueError('Revisar a grade de quadros para FPS diferente: ' + rate)
    # Margem de respiro depois do fonema final; nenhuma taxa de fala ou trim uniforme.
    start_frame = max(0, math.floor(max(0, words[0]['start'] / 1000 - .06) * fps))
    end_frame = min(math.floor(duration * fps), math.ceil((words[-1]['end'] / 1000 + .06) * fps))
    start, end = start_frame / fps, end_frame / fps
    if words[-1]['end'] / 1000 > end + .001:
        raise ValueError('Corte pisaria na última palavra: ' + shot['id'])
    length = end - start
    clips.append({'shot': shot['id'], 'file': str(source), 'sourceSeconds': duration,
                  'audioStart': start, 'audioEnd': end, 'audioSeconds': length,
                  'firstWord': words[0]['text'], 'lastWord': words[-1]['text'],
                  'lastWordEnd': words[-1]['end'] / 1000,
                  'removedHead': start, 'removedTail': duration - end,
                  'timelineStart': offset, 'asr': str(cache)})
    for word in words:
        text = word['text'].strip('.,!?;:“”"')
        caption_words.append({'w': text, 'start': offset + word['start'] / 1000 - start,
                              'end': offset + word['end'] / 1000 - start})
    offset += length

filters = []
for i, clip in enumerate(clips):
    incoming = 0 if i == 0 else 3 / fps
    outgoing = 0 if i == len(clips) - 1 else 3 / fps
    clip.update(lCutIncoming=incoming, lCutOutgoing=outgoing,
                incomingPictureHandle='3 quadros iniciais mantidos antes da fala; sincronia da boca preservada' if incoming else None)
    # O vídeo seguinte entra antes do fim do áudio anterior. O pequeno pre-roll
    # usa o primeiro quadro, pois o Veo inicia a fala sem alça anterior disponível.
    filters.append(f"[{i}:v]trim=start={clip['audioStart']:.9f}:end={clip['audioEnd']-outgoing:.9f},setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration={incoming:.9f}[v{i}]")
    filters.append(f"[{i}:a]atrim=start={clip['audioStart']:.9f}:end={clip['audioEnd']:.9f},asetpts=PTS-STARTPTS,afade=t=in:d=0.006,afade=t=out:st={clip['audioSeconds']-.006:.9f}:d=0.006[a{i}]")
filters.append(''.join(f'[v{i}]' for i in range(len(clips))) + f'concat=n={len(clips)}:v=1:a=0[picture]')
filters.append(''.join(f'[a{i}]' for i in range(len(clips))) + f'concat=n={len(clips)}:v=0:a=1[sound]')
filters.append(f"[picture]ass=legendas.ass:fontsdir={LIBRARY / 'fonts'}[out]")
(HERE / 'filtros.ffmpeg').write_text(';\n'.join(filters))
(HERE / 'palavras-editadas.json').write_text(json.dumps(caption_words, ensure_ascii=False, indent=2))

node = r"""
const fs = require('fs');
const {buildAss} = require(process.argv[1]);
const words = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ass = buildAss(words, {style:'karaoke', width:720, height:1280,
  font:'Montserrat ExtraBold', size:72, color:'#ffffff', highlight:'#ffffff',
  outline:'#000000', outlineWidth:3.4, position:'middle', uppercase:true,
  maxWords:3, maxChars:15, linger:0.08});
ass = ass.split('\n').map(line => {
  if (line.startsWith('Style:')) {const a=line.split(','); a[7]='0'; a[17]='2'; line=a.join(',');}
  if (line.startsWith('Dialogue:')) {const a=line.split(','); a[9]='{\\pos(360,744)}'+a.slice(9).join(','); line=a.slice(0,10).join(',');}
  return line;
}).join('\n');
fs.writeFileSync(process.argv[3],ass);
"""
subprocess.run(['node', '-e', node, str(LIBRARY / 'src/index.js'), str(HERE / 'palavras-editadas.json'), str(HERE / 'legendas.ass')], check=True)
manifest = {'schema': 'expert-edit/v1', 'reference': workflow['ref'], 'fps': fps,
            'clips': clips, 'sourceSeconds': sum(c['sourceSeconds'] for c in clips),
            'editedSeconds': offset, 'output': str(OUTPUT),
            'captions': {'font': 'Montserrat ExtraBold', 'sizeAt720':72, 'color':'white',
                         'outline':3.4, 'position':[360,744], 'style':'blocos curtos, caixa alta; branco uniforme como a referência',
                         'library':'https://github.com/CosLynxAI/ffmpeg-word-captions',
                         'fonts':'https://github.com/google/fonts/tree/main/ofl/montserrat'},
            'audioChanges':'Somente cortes e microfades de 6 ms nas bordas; sem atempo e sem reescrita da fala.',
            'review':'Em revisão; não equivale a aprovação humana.'}
(HERE / 'edicao.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
command = [FFMPEG, '-hide_banner', '-y', '-filter_complex_threads', '2']
for c in clips:
    command += ['-i', c['file']]
command += ['-/filter_complex', str(HERE / 'filtros.ffmpeg'), '-map', '[out]', '-map', '[sound]',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-threads', '4',
            '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', str(fps),
            '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', str(OUTPUT)]
with (HERE / 'render.log').open('w') as log:
    subprocess.run(command, cwd=HERE, stdout=log, stderr=log, check=True)
print(json.dumps({'output':str(OUTPUT),'sourceSeconds':manifest['sourceSeconds'],
                  'editedSeconds':offset,'removedSeconds':manifest['sourceSeconds']-offset,
                  'lCuts':len(clips)-1,'words':len(caption_words)}, ensure_ascii=False))
