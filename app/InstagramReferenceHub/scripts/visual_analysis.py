"""Leitura multimodal independente dos mesmos frames Watch. Sem navegador ou tools LLM.
O ASR é coletado pelo Hub; texto e quadros são dados não confiáveis.
"""
import base64, getpass, hashlib, json, os, re, subprocess, tempfile
from pathlib import Path
MODELS=('claude-opus-5-5','claude-sonnet-5-5')
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def decode_object(text):
 decoder=json.JSONDecoder()
 for match in re.finditer(r'\{',text):
  try:
   obj,_=decoder.raw_decode(text[match.start():])
   if isinstance(obj,dict) and isinstance(obj.get('shots'),list):return obj
  except ValueError:pass
 raise ValueError('Leitor visual não retornou mapa JSON')
def collection_status(readers,gemini=0):
 return 'aguardando_conferencia' if readers==[0,0] else 'erro'
def result_payload(stdout,model):
 events=[json.loads(line) for line in stdout.splitlines() if line.startswith('{')]
 result=next((e for e in reversed(events) if e.get('type')=='result'),None)
 if not result or result.get('is_error'):raise ValueError('Claude não concluiu a leitura: '+str((result or {}).get('result','resposta incompleta'))[:600])
 usage=result.get('modelUsage',{})
 # O Claude Code pode usar o Haiku em tarefa auxiliar interna (título/resumo); a leitura continua sendo do modelo pedido.
 if model not in usage or any(k!=model and not k.startswith('claude-haiku') for k in usage):raise ValueError('Resposta de outro modelo: '+','.join(usage))
 return result

def claude_environment(source=None):
 # launchd/serviços podem fornecer HOME sem USER. O Claude usa o usuário local
 # para localizar a sessão no Keychain; não copie tokens nem peça outro login.
 env=dict(os.environ if source is None else source)
 # Windows não tem `pwd` (OrganicSet, 09/11/2026): getpass resolve o usuário local nos dois sistemas.
 username=getpass.getuser()
 for key in ('USER','LOGNAME'):
  if not env.get(key):env[key]=username
 return env

def claude_call(model,prompt,images,output,timeout=480):
 content=[{'type':'text','text':prompt}]
 for image in images:
  content.append({'type':'image','source':{'type':'base64','media_type':'image/jpeg','data':base64.b64encode(Path(image).read_bytes()).decode()}})
 message={'type':'user','message':{'role':'user','content':content}}
 padrao=Path.home()/'.local/bin'/('claude.exe' if os.name=='nt' else 'claude')
 cmd=[os.environ.get('IRH_CLAUDE_BIN',str(padrao)),'-p','--model',model,'--effort','low','--verbose','--input-format','stream-json','--output-format','stream-json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--settings','{"disableAllHooks":true}','--disable-slash-commands','--no-session-persistence']
 with tempfile.TemporaryDirectory(prefix='irh-visual-cli-') as cwd:
  proc=subprocess.run(cmd,input=json.dumps(message)+'\n',capture_output=True,text=True,timeout=timeout,cwd=cwd,env=claude_environment())
 output=Path(output);output.with_suffix('.stderr.log').write_text(proc.stderr)
 # Outputs contain provenance/usage and observations; never persist base64 input.
 output.with_suffix('.events.jsonl').write_text(proc.stdout)
 result=result_payload(proc.stdout,model)
 if proc.returncode:raise ValueError('CLI visual falhou '+str(proc.returncode))
 record={'modelo':model,'effort':'low','result':result.get('result',''),'modelUsage':result['modelUsage'],'duration_ms':result.get('duration_ms'),'images':[{'path':str(p),'sha256':sha(p)} for p in images]}
 output.write_text(json.dumps(record,ensure_ascii=False,indent=2));return record

def watch_frames(evidence,duration):
 report=(evidence/'watch.md').read_text();step=max(.5,duration/98)
 frames=[]
 for path in re.findall(r'^- `([^`]+\.jpg)` \(t=',report,re.M):
  p=Path(path).resolve();p.relative_to(evidence.parent.resolve())
  cue=re.search(r'cue_(\d+)\.jpg$',path)
  if not cue or not p.is_file():raise ValueError('Frame Watch inválido')
  frames.append({'id':len(frames),'t':round(int(cue[1])*step,4),'path':p})
 if not frames:raise ValueError('Watch sem frames')
 return frames

def image_sheets(evidence,frames):
 from PIL import Image,ImageDraw
 directory=evidence/'visual-sheets';directory.mkdir(exist_ok=True);sheets=[]
 for start in range(0,len(frames),4):
  sheet=Image.new('RGB',(768,1420),'#101010');draw=ImageDraw.Draw(sheet)
  for n,f in enumerate(frames[start:start+4]):
   im=Image.open(f['path']).convert('RGB');im.thumbnail((384,670));x=(n%2)*384;y=(n//2)*710
   sheet.paste(im,(x+(384-im.width)//2,y+35));draw.text((x+8,y+10),f"frame_id={f['id']} | t={f['t']:.4f}s",fill='white')
  path=directory/f'{start//4+1:03}.jpg';sheet.save(path,quality=92);sheets.append(path)
 return sheets
