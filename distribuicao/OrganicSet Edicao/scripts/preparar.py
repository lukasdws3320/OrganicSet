"""Prepara um vídeo para a alteração pontual.

  py scripts\\preparar.py --nome caixa-bicarbonato --video "C:\\...\\video.mp4"   (ou um link do Drive, Instagram, TikTok)
                          [--referencia "C:\\...\\foto.png"]

Cria projetos\\<nome>\\ com: original.mp4, transcricao.json, frames\\ (quadro inicial + tira início/meio/fim de cada
trecho) e projeto.json (trechos com tempo e fala). Trechos seguem os cortes de câmera; trecho acima de 8 s é partido
na pausa da fala mais perto do meio.
"""
import argparse, json, os, re, shutil, subprocess, sys, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TETO = 8.0


def sair(msg):
    print(json.dumps({"erro": msg}, ensure_ascii=False)); sys.exit(1)


def roda(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf8", errors="replace", **kw)


def baixar(url, destino):
    m = re.search(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?id=)([\w-]+)", url)
    if m:
        u = f"https://drive.usercontent.google.com/download?id={m.group(1)}&export=download&confirm=t"
        with urllib.request.urlopen(u, timeout=300) as r, open(destino, "wb") as f:
            if "text/html" in r.headers.get("Content-Type", ""):
                sair("O Drive pediu login: deixe o arquivo como 'Qualquer pessoa com o link' ou baixe e use o arquivo.")
            shutil.copyfileobj(r, f)
        return
    r = roda([sys.executable, "-m", "yt_dlp", "-f", "mp4/best", "-o", destino, "--force-overwrites", url])
    if r.returncode != 0 or not os.path.exists(destino):
        sair("Não consegui baixar o link. Baixe o vídeo e passe o arquivo. Detalhe: " + r.stderr[-300:])


def duracao(v):
    return float(roda(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", v]).stdout.strip())


def cortes(v):
    r = roda(["ffmpeg", "-hide_banner", "-i", v, "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"])
    ts = sorted(float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr))
    out = []
    for t in ts:
        if not out or t - out[-1] > 0.6: out.append(t)
    return out


def transcrever(v):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sair("Falta o faster-whisper. Rode de novo o Instalar.bat.")
    import numpy as np
    # O áudio sai pelo ffmpeg (16 kHz mono): não depende da versão do PyAV, que já quebrou o faster-whisper.
    bruto = subprocess.run(["ffmpeg", "-v", "error", "-i", v, "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"], capture_output=True).stdout
    if not bruto: sair("Não consegui ler o áudio do vídeo.")
    modelo = WhisperModel("small", device="cpu", compute_type="int8")
    segs, info = modelo.transcribe(np.frombuffer(bruto, dtype=np.float32), word_timestamps=True, vad_filter=True)
    palavras = [{"w": w.word.strip(), "ini": round(w.start, 3), "fim": round(w.end, 3)} for s in segs for w in (s.words or [])]
    return info.language, palavras


def partir(ini, fim, palavras):
    if fim - ini <= TETO + 0.1: return [(ini, fim)]
    dentro = [p for p in palavras if ini < p["ini"] < fim]
    meio, melhor = (ini + fim) / 2, None
    for a, b in zip(dentro, dentro[1:]):
        corte = (a["fim"] + b["ini"]) / 2
        if ini + 1.5 < corte < fim - 1.5:
            nota = (b["ini"] - a["fim"]) * 2 - abs(corte - meio) / (fim - ini) + (0.5 if re.search(r"[.!?,]$", a["w"]) else 0)
            if melhor is None or nota > melhor[0]: melhor = (nota, corte)
    corte = melhor[1] if melhor else ini + TETO
    corte = min(corte, ini + TETO)
    return partir(ini, corte, palavras) + partir(corte, fim, palavras)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nome", required=True); ap.add_argument("--video", required=True); ap.add_argument("--referencia")
    a = ap.parse_args()
    nome = re.sub(r"[^a-z0-9-]+", "-", a.nome.lower()).strip("-")
    pasta = os.path.join(RAIZ, "projetos", nome); os.makedirs(os.path.join(pasta, "frames"), exist_ok=True)
    original = os.path.join(pasta, "original.mp4")
    if re.match(r"https?://", a.video): baixar(a.video, original)
    elif os.path.exists(a.video): shutil.copyfile(a.video, original)
    else: sair("Vídeo não encontrado: " + a.video)
    if a.referencia:
        if not os.path.exists(a.referencia): sair("Imagem de referência não encontrada: " + a.referencia)
        shutil.copyfile(a.referencia, os.path.join(pasta, "referencia" + os.path.splitext(a.referencia)[1].lower()))
    total = duracao(original)
    idioma, palavras = transcrever(original)
    json.dump({"idioma": idioma, "palavras": palavras}, open(os.path.join(pasta, "transcricao.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
    marcas = [0.0] + [t for t in cortes(original) if 0.3 < t < total - 0.3] + [total]
    janelas = [j for x, y in zip(marcas, marcas[1:]) for j in partir(x, y, palavras)]
    # sobra menor que 1 s no fim junta com o trecho anterior, se couber
    if len(janelas) > 1 and janelas[-1][1] - janelas[-1][0] < 1 and janelas[-1][1] - janelas[-2][0] <= TETO + 0.1:
        janelas[-2:] = [(janelas[-2][0], janelas[-1][1])]
    trechos = []
    for i, (x, y) in enumerate(janelas, 1):
        tid = f"T{i:02d}"
        fala = " ".join(p["w"] for p in palavras if x <= (p["ini"] + p["fim"]) / 2 < y).strip()
        quadro = os.path.join("frames", f"{tid}.jpg")
        roda(["ffmpeg", "-v", "error", "-y", "-ss", f"{x + 0.05:.3f}", "-i", original, "-frames:v", "1", "-q:v", "2", os.path.join(pasta, quadro)])
        pts = [x + 0.05, (x + y) / 2, max(x + 0.05, y - 0.15)]
        tira = os.path.join(pasta, "frames", f"{tid}_tira.jpg")
        entradas = sum([["-ss", f"{t:.3f}", "-i", original] for t in pts], [])
        roda(["ffmpeg", "-v", "error", "-y", *entradas, "-filter_complex",
              "[0:v]scale=-2:480[a];[1:v]scale=-2:480[b];[2:v]scale=-2:480[c];[a][b][c]hstack=3", "-frames:v", "1", tira])
        trechos.append({"id": tid, "ini": round(x, 3), "fim": round(y, 3), "duracao": round(y - x, 2), "frame": quadro.replace("\\", "/"),
                        "tira": f"frames/{tid}_tira.jpg", "fala_original": fala, "fala": fala, "quem": "", "acao": "", "camera": "",
                        "prompt_imagem": "", "imagem": None, "estado": "novo", "nota": "", "prompts": {}})
    ref = next((f for f in os.listdir(pasta) if f.startswith("referencia.")), None)
    projeto = {"nome": nome, "video": "original.mp4", "duracao": round(total, 2), "idioma": idioma, "referencia": ref,
               "alteracao": {"tipo": "", "descricao": ""}, "piloto": [], "trechos": trechos}
    destino = os.path.join(pasta, "projeto.json")
    if os.path.exists(destino): shutil.copyfile(destino, destino + ".anterior")
    json.dump(projeto, open(destino, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(json.dumps({"pasta": pasta, "duracao": round(total, 2), "idioma": idioma, "trechos": len(trechos),
                      "maior_trecho": max(t["duracao"] for t in trechos), "referencia": ref}, ensure_ascii=False))


if __name__ == "__main__":
    main()
