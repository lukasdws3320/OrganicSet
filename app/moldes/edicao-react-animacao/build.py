# MOLDE (REF-2026-10-0201, React + Animação): copiar para a pasta edicao/montagem da REF e trocar D, segs e cores.
import json,subprocess,sys
D='app/GoogleFlowMCP/outputs/<REF>/<slug>/workflow-<runId>'  # pasta dos clipes do workflow desta REF
S=sys.argv[1];OUT=sys.argv[2]
clip=lambda n:f'{D}/SHOT0{n}/tentativa-2/SHOT0{n}.shot.mp4'
# (fundo, react, duração, cor de fundo do plate, palavras da legenda literal com tempos medidos)
segs=[(1,2,7.75,'0x6f6b68',[('Você',0,.3),('sabia',.3,.74),('que',.74,.94),('se',.94,1.06),('colocar',1.06,1.42),('4',1.42,1.96),('ovos',1.96,2.44),('cozidos,',2.44,3.02),('3',3.4,3.74),('colheres',3.74,4.22),('de',4.22,4.38),('sopa',4.38,4.76),('de',4.76,4.9),('azeite,',4.9,5.5),('1',5.74,6.1),('colher',6.1,6.46),('de',6.46,6.58),('sopa',6.58,6.94),('de',6.94,7.06),('vinagre,',7.06,7.64)]),
 (3,4,7.8,'0xfefefe',[('1/4',0,.42),('de',.42,.68),('xícara',.68,1.1),('de',1.1,1.3),('água',1.3,1.68),('e',1.68,2.08),('uma',2.08,2.2),('pitada',2.2,2.66),('de',2.66,2.82),('sal',2.82,3.12),('e',3.12,3.34),('pimenta-do-reino,',3.34,4.3),('bater',4.46,4.88),('tudo',4.88,5.2),('até',5.2,5.46),('ficar',5.46,5.7),('homogêneo',5.7,6.56),('e',6.56,6.74),('bem',6.74,6.96),('combinado,',6.96,7.7)]),
 (5,6,7.49,'0x6d6868',[('e',0.00,0.14),('pronto!',0.14,0.48),('Você',0.94,1.12),('acaba',1.12,1.42),('de',1.42,1.68),('ter',1.68,1.86),('uma',1.86,2.02),('maionese',2.02,2.60),('rica',2.60,3.08),('em',3.08,3.16),('proteínas.',3.16,3.96),('Comente',4.16,4.76),('eu',4.96,5.02),('quero',5.02,5.20),('que',5.20,5.36),('eu',5.36,5.44),('te',5.44,5.52),('mando',5.52,5.84),('mais',5.84,6.14),('receitas',6.14,6.64),('saudáveis.',6.64,7.24)])]
from PIL import Image,ImageDraw,ImageFont
FONT=ImageFont.truetype('app/fontes/Poppins-ExtraBold.ttf',66)
import os;os.makedirs(S+'/leg',exist_ok=True)
def card(words,active,path):
  im=Image.new('RGBA',(1080,220),(0,0,0,0));d=ImageDraw.Draw(im)
  sp=d.textlength(' ',font=FONT);ws=[d.textlength(w,font=FONT) for w in words];x=(1080-(sum(ws)+sp*(len(words)-1)))/2;y=70
  for k,w in enumerate(words):
    if k==active:d.rounded_rectangle((x-14,y-6,x+ws[k]+14,y+86),radius=16,fill=(230,15,214,255))
    d.text((x,y),w,font=FONT,fill='white',stroke_width=0 if k==active else 5,stroke_fill='black')
    x+=ws[k]+sp
  im.save(path)
Image.new('RGBA',(1080,220),(0,0,0,0)).save(S+'/leg/blank.png')
events=[];off=0;n=0
for _,_,dur,_,words in segs:
  chunks=[words[i:i+3] for i in range(0,len(words),3)]
  for ci,ch in enumerate(chunks):
    nxt=chunks[ci+1][0][1] if ci+1<len(chunks) else dur
    for wi,(w,a,b) in enumerate(ch):
      end=ch[wi+1][1] if wi+1<len(ch) else nxt
      n+=1;f=f'{S}/leg/{n:03d}.png';card([x for x,_,_ in ch],wi,f);events.append((off+a,off+end,f))
  off+=dur
lines=['ffconcat version 1.0'];cur=0
for a,b,f in events:
  if a>cur+.001:lines+=[f"file '{S}/leg/blank.png'",f'duration {a-cur:.3f}']
  lines+=[f"file '{f}'",f'duration {b-a:.3f}'];cur=b
lines+=[f"file '{S}/leg/blank.png'",f'duration {max(off-cur,0.04):.3f}',f"file '{S}/leg/blank.png'"]
open(S+'/leg.ffconcat','w').write('\n'.join(lines)+'\n')
parts=[]
RSTART={6:.36}
CROP={2:('454:838:266:432',821),4:(None,810),6:('510:900:210:370',808)}
for i,(f,r,dur,col,_) in enumerate(segs):
  o=f'{S}/seg{i+1}.mp4';cr,ph=CROP[r]
  fc=(f"[0:v]trim=0:{dur},setpts=PTS-STARTPTS,scale=1080:1920,setsar=1,fps=30[bg];"
      f"[1:v]trim={RSTART.get(r,0)}:{RSTART.get(r,0)+dur},setpts=PTS-STARTPTS,crop={cr},colorkey={col}:0.13:0.06,scale=-2:{ph},fps=30[pl];"
      f"[bg][pl]overlay=W-w+10:H-h-70[v];"
      f"[0:a]atrim=0:{dur},asetpts=PTS-STARTPTS,volume=0.22[a0];[1:a]atrim={RSTART.get(r,0)}:{RSTART.get(r,0)+dur},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st={dur-0.08}:d=0.08[a1];[a0][a1]amix=inputs=2:normalize=0[a]")
  if r==4:  # fundo branco: recorte por inundação (matte.py), cor-chave apagaria tênis e olhos
    fc=fc.replace(f"[1:v]trim={RSTART.get(r,0)}:{RSTART.get(r,0)+dur},setpts=PTS-STARTPTS,crop={cr},colorkey={col}:0.13:0.06,","[2:v]format=rgba,")
  subprocess.run(['ffmpeg','-y','-loglevel','error','-i',clip(f),'-i',clip(r),*(['-i',S+'/plate4.mov'] if r==4 else []),'-filter_complex',fc,'-map','[v]','-map','[a]','-c:v','libx264','-crf','16','-preset','medium','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000',o],check=True)
  parts.append(o)
open(f'{S}/list.txt','w').write(''.join(f"file '{p}'\n" for p in parts))
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',f'{S}/list.txt','-f','concat','-safe','0','-i',f'{S}/leg.ffconcat','-filter_complex','[1:v]fps=30,format=rgba[l];[0:v][l]overlay=0:760:eof_action=pass:shortest=0[v]','-map','[v]','-map','0:a','-c:v','libx264','-crf','17','-preset','medium','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',OUT],check=True)
print('ok',OUT)
