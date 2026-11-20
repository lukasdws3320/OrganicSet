"""Página do editor de uma produção do Hub (alteração pontual ou replicação comum).

Um cartão por trecho, na ordem: quadro original, imagem inicial, clipe (se já houver), fala, prompt do vídeo
e o tempo de uso de cada clipe. Monta a pasta pronta para o agente publicar como Artifact.

  python3 scripts/pagina-editor.py --id REF-AAAA-MM-NNNN--slug --saida <pasta> [--titulo "Cortes X"]
      [--subtitulo "..."] [--alteracao "trocar a caixa ..."] [--notas notas.json] [--sem-videos]

notas.json (opcional): {"SHOT07": {"estado": "refazer", "nota": "...", "prompt_corrigido": "..."}}
Estados: ok · ressalva · refazer · falta · agerar (vídeo ainda não gerado, prompt pronto para copiar).
Sem --notas: clipe disponível = ok; sem clipe = agerar (ou falta, se o Flow recusou).
Hub aberto em http://127.0.0.1:4317. Saída: <saida>/pagina-editor.html + img/ + clipes/.
"""
import argparse, html, json, os, re, shutil, subprocess, urllib.request

p = argparse.ArgumentParser()
p.add_argument("--id", required=True); p.add_argument("--saida", required=True)
p.add_argument("--titulo"); p.add_argument("--subtitulo", default="")
p.add_argument("--alteracao", default=""); p.add_argument("--notas")
p.add_argument("--sem-videos", action="store_true", help="modo só imagens + prompts: não copia clipes")
a = p.parse_args()

estado = json.load(urllib.request.urlopen(f"http://127.0.0.1:4317/api/replicacoes/{a.id}/execucao"))
plano = estado["plan"]; notas = json.load(open(a.notas, encoding="utf8")) if a.notas else {}
os.makedirs(os.path.join(a.saida, "img"), exist_ok=True); os.makedirs(os.path.join(a.saida, "clipes"), exist_ok=True)
assets = {x["id"]: x for x in plano["assets"]}
jobs = {(j["kind"], j["id"]): j for j in estado["jobs"]}

def thumb(src, nome):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", "scale=360:-2", "-q:v", "4", os.path.join(a.saida, "img", nome)], check=True)

def modelo_do(job):
    try: return json.load(open(job["executionPlan"], encoding="utf8"))["settings"]["videoModel"]
    except Exception: return plano["settings"]["videoModel"]

def tc(s):
    m, r = divmod(s, 60); return f"{int(m)}:{r:05.2f}"

LBL = {"ok": "Pronto", "ressalva": "Pronto, com ressalva", "refazer": "Refazer", "falta": "Sem vídeo", "agerar": "Vídeo a gerar"}
PL = {"ok": "prontos", "ressalva": "com ressalva", "refazer": "para refazer", "falta": "sem vídeo", "agerar": "a gerar"}
cards, cont, modelos = [], {}, {}
for sh in plano["shots"]:
    sid = sh["id"]; st = next(x for x in plano["stills"] if x["id"] == sh["still"])
    frame = next((assets[i]["path"] for i in st["inputs"] if re.search(r"[\\/]frames[\\/]", assets[i]["path"])), None)
    img, vid = jobs.get(("image", sh["still"]), {}), jobs[("video", sid)]
    if frame: thumb(frame, f"{sid}_original.jpg")
    if img.get("output"): thumb(img["output"], f"{sid}_nova.jpg")
    tem_video = not a.sem_videos and vid["status"] == "available" and vid.get("output")
    if tem_video:
        shutil.copyfile(vid["output"], os.path.join(a.saida, "clipes", sid + ".mp4"))
        modelos.setdefault(modelo_do(vid), []).append(sid)
    n = notas.get(sid, {})
    e = n.get("estado") or ("ok" if tem_video else "falta" if vid["status"] == "error" and "Recusa" in (vid.get("error") or "") else "agerar")
    cont[e] = cont.get(e, 0) + 1
    ini, fim = sh["sourceWindow"]; fala = sh.get("spokenSpeech") or sh.get("speech") or ""
    turnos = re.findall(r"\[([^\]]+)\]\s*([^\[]+)", fala)
    falas = "".join(f'<p class="fala"><span class="quem">{html.escape(q.split(",")[0])}</span> {html.escape(t.strip())}</p>' for q, t in turnos) if turnos \
        else (f'<p class="fala">{html.escape(fala)}</p>' if fala else '<p class="fala muda">Sem fala. Só som ambiente.</p>')
    modelo = modelo_do(vid) if tem_video else plano["settings"]["videoModel"]
    video = (f'<figure><video controls preload="none" playsinline poster="img/{sid}_nova.jpg" src="clipes/{sid}.mp4"></video><figcaption>Clipe gerado · {html.escape(modelo)}</figcaption></figure>'
             if tem_video else '<figure class="vazio"><div>Sem clipe ainda</div><figcaption>Clipe gerado</figcaption></figure>')
    extra = ""
    if n.get("prompt_corrigido"):
        extra = f'<details open><summary>Prompt corrigido para a refação</summary><p class="prompt" id="p-{sid}-c">{html.escape(n["prompt_corrigido"])}</p><button type="button" class="copiar" data-alvo="p-{sid}-c">Copiar prompt corrigido</button></details>'
    nota = f'<p class="nota">{html.escape(n["nota"])}</p>' if n.get("nota") else ""
    original = f'<figure><img loading="lazy" src="img/{sid}_original.jpg" alt="Quadro original do {sid}"><figcaption>Original</figcaption></figure>' if frame else ""
    cards.append(f'''
<article class="corte" data-estado="{e}" id="{sid.lower()}">
 <header class="corte-cab"><h2>{sid}</h2><span class="chip {e}">{LBL[e]}</span><span class="tc">{tc(ini)} → {tc(fim)} · usar {fim-ini:.2f} s</span></header>
 <div class="corpo">
  <div class="quadros">{original}
   <figure><img loading="lazy" src="img/{sid}_nova.jpg" alt="Imagem inicial do {sid}"><figcaption>Imagem inicial · {html.escape(plano["settings"].get("imageModel", "Nano Banana"))}</figcaption></figure>
   {video}
  </div>
  <div class="texto">{nota}
   <h3>Fala</h3>{falas}
   <h3>Prompt do vídeo <span class="fino">· Flow, modo {plano["settings"]["videoMode"]}, {html.escape(modelo)}, {plano["settings"]["aspectRatio"]}, {plano["settings"]["resolution"]}, 8 s</span></h3>
   <p class="prompt" id="p-{sid}">{html.escape(vid["prompt"])}</p>
   <button type="button" class="copiar" data-alvo="p-{sid}">Copiar prompt</button>{extra}
  </div>
 </div>
</article>''')

ids = [s["id"] for s in plano["shots"]]
if len(modelos) > 1:
    mtxt = "<p>" + "; ".join(f"{', '.join(v)}: {html.escape(k)}" for k, v in modelos.items()) + ". Pode ser preciso igualar cor e nitidez entre os modelos.</p>"
else:
    mtxt = ""
passo_video = ("A imagem entra no Google Flow como quadro inicial (modo Frames) com o prompt ao lado. O prompt prende rosto, roupa e a alteração, diz quem fala e o texto exato, e repete a ação e o movimento de câmera do original."
               if not a.sem_videos else "Os vídeos ainda não foram gerados: cada trecho já tem o prompt pronto para colar no Google Flow (modo Frames), com a imagem inicial como primeiro quadro.")
passo_conf = ("Cada clipe foi revisado quadro a quadro, e a fala foi transcrita e comparada com o roteiro."
              if not a.sem_videos else "Cada imagem inicial foi comparada com o quadro original antes de entrar aqui.")
titulo = a.titulo or f"Cortes {plano['expert']}"
resumo = "".join(f'<span class="chip {k}">{cont[k]} {PL[k]}</span>' for k in LBL if cont.get(k))
modelo_html = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pagina-editor.html"), encoding="utf8").read()
rep = {"%%CARDS%%": "\n".join(cards), "%%RESUMO%%": resumo, "%%TOTAL%%": tc(plano["shots"][-1]["sourceWindow"][1]), "%%N%%": str(len(ids)),
       "%%TITULO%%": html.escape(titulo), "%%SUB%%": html.escape(a.subtitulo), "%%REF%%": html.escape(plano["ref"]),
       "%%ALTERACAO%%": html.escape(a.alteracao or "a mudança pedida"), "%%PASSO_VIDEO%%": passo_video, "%%PASSO_CONFERENCIA%%": passo_conf,
       "%%ORDEM%%": f"{ids[0]} → {ids[-1]}", "%%MODELOS%%": mtxt}
for k, v in rep.items(): modelo_html = modelo_html.replace(k, v)
open(os.path.join(a.saida, "pagina-editor.html"), "w", encoding="utf8").write(modelo_html)
arquivos = [f"img/{x}" for x in sorted(os.listdir(os.path.join(a.saida, "img")))] + [f"clipes/{x}" for x in sorted(os.listdir(os.path.join(a.saida, "clipes")))]
json.dump([{"path": x} for x in arquivos], open(os.path.join(a.saida, "arquivos.json"), "w", encoding="utf8"))
print(json.dumps({"pagina": os.path.join(a.saida, "pagina-editor.html"), "arquivos": len(arquivos), "estados": cont}, ensure_ascii=False))
