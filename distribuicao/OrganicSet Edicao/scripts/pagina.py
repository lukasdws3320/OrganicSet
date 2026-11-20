"""Monta a página do projeto (um arquivo HTML só, com as imagens dentro).

  py scripts\\pagina.py --projeto caixa-bicarbonato            -> projetos\\<nome>\\entrega\\pagina.html (todos os trechos)
  py scripts\\pagina.py --projeto caixa-bicarbonato --piloto   -> projetos\\<nome>\\entrega\\piloto.html (só os do piloto)

Cada trecho: quadro original, imagem nova, tempo de uso, fala e os prompts de vídeo em abas (Veo 3, Kling, Seedance, MiniMax).
"""
import argparse, base64, html, io, json, os, subprocess, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IAS = [("veo3", "Veo 3"), ("kling", "Kling"), ("seedance", "Seedance 2.0"), ("minimax", "MiniMax")]
LBL = {"aprovado": "Pronto", "imagem-gerada": "Imagem pronta", "ressalva": "Pronto, com ressalva", "refazer": "Refazer", "novo": "Sem imagem ainda", "piloto": "Piloto"}
CLS = {"aprovado": "ok", "imagem-gerada": "ok", "ressalva": "ressalva", "refazer": "refazer", "novo": "falta", "piloto": "agerar"}


def miniatura(caminho):
    if not caminho or not os.path.exists(caminho): return ""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", caminho, "-vf", "scale=360:-2", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", "pipe:1"], capture_output=True)
    return "data:image/jpeg;base64," + base64.b64encode(r.stdout).decode() if r.returncode == 0 and r.stdout else ""


def tc(s):
    m, r = divmod(s, 60); return f"{int(m)}:{r:05.2f}"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--projeto", required=True); ap.add_argument("--piloto", action="store_true")
    ap.add_argument("--titulo"); a = ap.parse_args()
    pasta = os.path.join(RAIZ, "projetos", a.projeto); p = json.load(open(os.path.join(pasta, "projeto.json"), encoding="utf8"))
    trechos = [t for t in p["trechos"] if not a.piloto or t["id"] in p.get("piloto", [])]
    if not trechos: print(json.dumps({"erro": "Nenhum trecho para mostrar (piloto vazio?)"}, ensure_ascii=False)); sys.exit(1)
    cards, cont = [], {}
    for t in trechos:
        e = t.get("estado", "novo"); cont[e] = cont.get(e, 0) + 1
        orig, nova = miniatura(os.path.join(pasta, t["frame"])), miniatura(os.path.join(pasta, t["imagem"])) if t.get("imagem") else ""
        abas, paineis = [], []
        for i, (k, nome) in enumerate(IAS):
            pr = t.get("prompts", {}).get(k)
            if not pr: continue
            texto = pr["prompt"] if isinstance(pr, dict) else pr
            dica = pr.get("config", "") if isinstance(pr, dict) else ""
            pid = f"p-{t['id']}-{k}"
            abas.append(f'<button type="button" role="tab" class="aba" data-painel="{pid}" aria-selected="{str(not abas).lower()}">{nome}</button>')
            paineis.append(f'<div class="painel" id="{pid}"{"" if len(paineis) == 0 else " hidden"}>{f"<p class=config>{html.escape(dica)}</p>" if dica else ""}'
                           f'<p class="prompt" id="{pid}-t">{html.escape(texto)}</p><button type="button" class="copiar" data-alvo="{pid}-t">Copiar prompt {nome}</button></div>')
        prompts = (f'<div class="abas" role="tablist">{"".join(abas)}</div>{"".join(paineis)}' if abas else '<p class="nota">Prompts ainda não escritos.</p>')
        fala = html.escape(t.get("fala") or "") or "<i>Sem fala. Só som ambiente.</i>"
        nota = f'<p class="nota">{html.escape(t["nota"])}</p>' if t.get("nota") else ""
        img_nova = f'<img src="{nova}" alt="Imagem nova do {t["id"]}">' if nova else '<div class="vazio">Sem imagem ainda</div>'
        cards.append(f'''<article class="corte" data-estado="{CLS.get(e, 'falta')}"><header class="cab"><h2>{t["id"]}</h2><span class="chip {CLS.get(e, 'falta')}">{LBL.get(e, e)}</span>
<span class="tc">{tc(t["ini"])} → {tc(t["fim"])} · usar {t["duracao"]:.2f} s</span></header><div class="corpo"><div class="quadros">
<figure><img src="{orig}" alt="Quadro original do {t["id"]}"><figcaption>Original</figcaption></figure><figure>{img_nova}<figcaption>Imagem nova</figcaption></figure></div>
<div class="texto">{nota}<h3>Fala</h3><p class="fala">{fala}</p><h3>Prompt do vídeo</h3>{prompts}</div></div></article>''')
    titulo = a.titulo or ("Piloto " if a.piloto else "Cortes ") + p["nome"].replace("-", " ").title()
    alt = p.get("alteracao", {})
    sub = html.escape(alt.get("descricao") or "")
    topo = ('<p class="aviso">Piloto: confira estas imagens antes de eu gerar as outras. Responda no chat do OrganicSet: "aprovado" ou o que precisa mudar.</p>'
            if a.piloto else f'<p class="aviso">Cada clipe deve usar só o tempo indicado em "usar". Junte na ordem {trechos[0]["id"]} → {trechos[-1]["id"]}.</p>')
    modelo = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pagina-modelo.html"), encoding="utf8").read()
    pag = modelo.replace("%%TITULO%%", html.escape(titulo)).replace("%%SUB%%", sub).replace("%%TOPO%%", topo).replace("%%CARDS%%", "\n".join(cards)) \
        .replace("%%META%%", f"{len(trechos)} trechos · vídeo de {tc(p['duracao'])} · fala em {p.get('idioma', '?')}")
    os.makedirs(os.path.join(pasta, "entrega"), exist_ok=True)
    destino = os.path.join(pasta, "entrega", "piloto.html" if a.piloto else "pagina.html")
    open(destino, "w", encoding="utf8").write(pag)
    print(json.dumps({"pagina": destino, "trechos": len(trechos), "estados": cont}, ensure_ascii=False))


if __name__ == "__main__":
    main()
