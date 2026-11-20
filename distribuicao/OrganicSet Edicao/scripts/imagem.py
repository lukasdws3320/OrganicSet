"""Gera a imagem inicial de um trecho no Nano Banana Pro (API do Gemini).

  py scripts\\imagem.py --projeto caixa-bicarbonato --trecho T01 [--correcao "deixe a caixa menor"]

Usa o quadro original do trecho + a imagem de referência do projeto + o prompt_imagem do trecho (projeto.json).
Salva imagens\\T01.png (refação vira T01_v2.png) e conferencia\\T01.jpg (original | nova, lado a lado).
Chave: %USERPROFILE%\\.config\\organicset-edicao\\gemini.env (GEMINI_API_KEY=...). Peça a chave ao Lukas.
"""
import argparse, base64, json, os, re, subprocess, sys, time, urllib.error, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAVE = os.path.join(os.path.expanduser("~"), ".config", "organicset-edicao", "gemini.env")


def sair(msg):
    print(json.dumps({"erro": msg}, ensure_ascii=False)); sys.exit(1)


def chave():
    if os.path.exists(CHAVE):
        m = re.search(r"^\s*GEMINI_API_KEY\s*=\s*(\S+)\s*$", open(CHAVE, encoding="utf8").read(), re.M)
        if m: return m.group(1)
    if os.environ.get("GEMINI_API_KEY"): return os.environ["GEMINI_API_KEY"]
    sair("Chave do Gemini não configurada. Peça a chave ao Lukas e rode 'Configurar chave.bat'.")


def mime(b):
    return "image/png" if b[:4] == b"\x89PNG" else "image/webp" if b[8:12] == b"WEBP" else "image/jpeg"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--projeto", required=True); ap.add_argument("--trecho", required=True)
    ap.add_argument("--correcao", default=""); ap.add_argument("--modelo", default="gemini-3-pro-image")
    ap.add_argument("--tamanho", default="2K")
    a = ap.parse_args()
    pasta = os.path.join(RAIZ, "projetos", a.projeto); arq = os.path.join(pasta, "projeto.json")
    if not os.path.exists(arq): sair("Projeto não encontrado. Rode antes o preparar.py.")
    p = json.load(open(arq, encoding="utf8"))
    t = next((x for x in p["trechos"] if x["id"] == a.trecho), None)
    if not t: sair("Trecho inexistente: " + a.trecho)
    if not t.get("prompt_imagem"): sair("O trecho ainda não tem prompt_imagem no projeto.json.")
    if not p.get("referencia"): sair("O projeto não tem imagem de referência (referencia.png/jpg na pasta do projeto).")
    partes = []
    for i, (caminho, papel) in enumerate([(t["frame"], "a cena original inteira, que deve ser preservada"),
                                         (p["referencia"], "somente o que entra na cena (a alteração pedida)")], 1):
        b = open(os.path.join(pasta, caminho), "rb").read()
        partes += [{"text": f"Referência {i}: {papel}."}, {"inline_data": {"mime_type": mime(b), "data": base64.b64encode(b).decode()}}]
    prompt = "Imagem vertical 9:16. " + t["prompt_imagem"] + (("\nCorreção pedida: " + a.correcao) if a.correcao else "")
    partes.append({"text": prompt})
    corpo = {"contents": [{"role": "user", "parts": partes}],
             "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16", "imageSize": a.tamanho}}}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{a.modelo}:generateContent",
                                 data=json.dumps(corpo).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": chave()})
    j = None
    for tentativa in range(4):
        try:
            j = json.load(urllib.request.urlopen(req, timeout=300)); break
        except urllib.error.HTTPError as e:
            det = e.read().decode("utf8", "replace")[:400]
            # 503/429/500 = Google sobrecarregado: esperar e tentar de novo (não cobra).
            if e.code in (429, 500, 503) and tentativa < 3:
                print(json.dumps({"aviso": f"Gemini ocupado ({e.code}); nova tentativa em {30 * (tentativa + 1)} s"}, ensure_ascii=False), flush=True)
                time.sleep(30 * (tentativa + 1)); continue
            if e.code == 402 or "prepayment credits" in det:
                sair("Os créditos da chave do Gemini acabaram. Avise o Lukas para recarregar no Google AI Studio; depois é só pedir de novo.")
            sair(("Chave do Gemini recusada: confira com o Lukas. " if e.code in (401, 403) else f"Gemini respondeu {e.code}. ") + det)
    img = next((x for x in j.get("candidates", [{}])[0].get("content", {}).get("parts", []) if (x.get("inlineData") or x.get("inline_data"))), None)
    if not img:
        sair("O Gemini não devolveu imagem (motivo: " + str(j.get("candidates", [{}])[0].get("finishReason")) + "). Ajuste o prompt e tente de novo.")
    dados = base64.b64decode((img.get("inlineData") or img.get("inline_data"))["data"])
    os.makedirs(os.path.join(pasta, "imagens"), exist_ok=True); os.makedirs(os.path.join(pasta, "conferencia"), exist_ok=True)
    n, nome = 1, f"{a.trecho}.png"
    while os.path.exists(os.path.join(pasta, "imagens", nome)): n += 1; nome = f"{a.trecho}_v{n}.png"
    destino = os.path.join(pasta, "imagens", nome); open(destino, "wb").write(dados)
    lado = os.path.join(pasta, "conferencia", f"{a.trecho}.jpg")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(pasta, t["frame"]), "-i", destino, "-filter_complex",
                    "[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=2", "-frames:v", "1", lado], check=False)
    t["imagem"] = f"imagens/{nome}"; t["estado"] = "imagem-gerada"
    json.dump(p, open(arq, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(json.dumps({"trecho": a.trecho, "imagem": destino, "conferencia": lado, "versao": n}, ensure_ascii=False))


if __name__ == "__main__":
    main()
