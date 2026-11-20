"""Snapshot a client's Flow production state as a self-contained local review page."""
from __future__ import annotations

import argparse
import html
import json
import os
from collections import Counter
from datetime import datetime
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]


def href(page: Path, target: Path) -> str:
    return html.escape(os.path.relpath(target, page.parent).replace(os.sep, "/"), quote=True)


def panel(expert: str, refs: list[str], output: Path) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    records = []
    sections = []
    totals = Counter()
    for ref in refs:
        folder = BASE / "outputs" / ref / "frames-bordoes-cadencia-2026-10-24"
        plan_file = folder / "plano.json"
        if not plan_file.exists():
            records.append({"ref": ref, "status": "sem plano revisado", "shots": []})
            sections.append(f'<section id="{ref}"><h2>{ref}</h2><p class="empty">Plano novo ainda não revisado. Preservar os arquivos antigos; revisar cadência e imagens antes de enviar.</p></section>')
            continue
        plan = json.loads(plan_file.read_text())
        state_file = folder / "flow-run.json"
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        items = state.get("items", {})
        cards = []
        shot_records = []
        for shot in plan["shots"]:
            sid = shot["id"]
            item = items.get(sid, {})
            clip = folder / f"{sid}.shot.mp4"
            still = next((s for s in plan.get("stills", []) if s.get("id") == shot.get("still")), {})
            input_item = items.get(shot.get("still"), {})
            image = Path(input_item.get("file") or still.get("file") or "")
            status = "baixado" if clip.is_file() else {"submitted": "enviado ao Flow", "available": "disponível no Flow"}.get(item.get("status"), "aguarda envio")
            totals[status] += 1
            takes = shot.get("sourceTakes", [])
            source_shots = shot.get("sourceShots", [sid])
            shot_records.append({"id": sid, "sourceShots": source_shots, "sourceTakes": takes,
                                 "duration": shot.get("duration"), "speech": shot.get("speech"),
                                 "still": shot.get("still"), "stillPath": str(image) if image.is_file() else None,
                                 "clipPath": str(clip) if clip.is_file() else None,
                                 "flowStatus": item.get("status", "not_submitted"), "displayStatus": status,
                                 "flowAssetId": item.get("assetId"), "promptPath": str(folder / "prompts" / f"{sid}.shot.txt")})
            media = (f'<video controls preload="none" playsinline src="{href(output, clip)}"></video>' if clip.is_file()
                     else f'<img loading="lazy" src="{href(output, image)}" alt="Imagem inicial de {sid}">' if image.is_file()
                     else '<div class="placeholder">Imagem não localizada</div>')
            prompt = folder / "prompts" / f"{sid}.shot.txt"
            links = (f'<a href="{href(output, prompt)}">Prompt</a>' if prompt.is_file() else '')
            if clip.is_file(): links += f'<a href="{href(output, clip)}" download>Baixar clipe</a>'
            cards.append(f'''<article class="shot"><div class="media">{media}</div><div class="body"><div class="eyebrow">{html.escape(" + ".join(source_shots))} · {shot.get("duration", "?")}s</div><h3>{html.escape(sid)} <span class="badge {"done" if clip.is_file() else "sent" if item.get("status")=="submitted" else "todo"}">{status}</span></h3><p>{html.escape(shot.get("speech") or "Sem fala — edição")}</p><details><summary>{len(takes)} takes vinculados</summary><p class="takes">{html.escape(" · ".join(takes) or "Nenhum")}</p></details><div class="links">{links}</div></div></article>''')
        organization = plan.get("organization") or {}
        project = state.get("project") or {}
        collection = (organization.get("collectionUrl") if isinstance(organization, dict) else None) or (project.get("collectionUrl") if isinstance(project, dict) else None)
        gallery = folder / "clips.html"
        ref_links = f'<a href="{href(output, plan_file)}">Plano JSON</a>'
        if collection: ref_links += f'<a href="{html.escape(collection, quote=True)}">Coleção Flow ↗</a>'
        if gallery.is_file(): ref_links += f'<a href="{href(output, gallery)}">Galeria de clipes</a>'
        sections.append(f'<section id="{ref}"><div class="section-head"><div><div class="eyebrow">REFERÊNCIA / {expert.upper()}</div><h2>{ref}</h2><p>{len(shot_records)} gerações planejadas · {sum(x["displayStatus"]=="baixado" for x in shot_records)} clipes locais · {sum(x["displayStatus"]=="enviado ao Flow" for x in shot_records)} enviados aguardando coleta</p></div><div class="links">{ref_links}</div></div><div class="grid">{"".join(cards)}</div></section>')
        records.append({"ref": ref, "status": "parcial" if any(x["displayStatus"]!="baixado" for x in shot_records) else "clipes baixados", "planPath": str(plan_file), "collectionUrl": collection, "shots": shot_records})
    nav = ''.join(f'<a href="#{r}">{r[-4:]}</a>' for r in refs)
    summary = ''.join(f'<div><strong>{totals[k]}</strong><span>{k}</span></div>' for k in ("baixado", "enviado ao Flow", "disponível no Flow", "aguarda envio"))
    stamp = datetime.now().astimezone().strftime('%d/%m/%Y %H:%M %Z')
    css = '''*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#080808;color:#f4f0ec;font:16px/1.5 Arial,sans-serif}a{color:#ee794e;text-decoration:none}a:hover{text-decoration:underline}.wrap{max-width:1480px;margin:auto;padding:32px 24px 100px}header{border-bottom:1px solid #303030;padding-bottom:28px}.eyebrow{font:11px/1.5 monospace;letter-spacing:.15em;color:#ee794e;text-transform:uppercase}h1{font-size:clamp(36px,6vw,78px);line-height:1.02;letter-spacing:-.055em;margin:16px 0}h2{font-size:clamp(28px,4vw,48px);letter-spacing:-.04em;margin:8px 0}h3{font-size:23px;margin:8px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap}p{color:#bdb8b3}.intro{max-width:780px}.metrics{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0}.metrics>div{background:#151515;border:1px solid #303030;min-width:140px;padding:15px 20px}.metrics strong{display:block;font-size:30px;color:#ee794e}.metrics span{font-size:12px;color:#bdb8b3}nav{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;background:#080808ec;padding:14px 0;z-index:2}nav a{border:1px solid #444;border-radius:99px;padding:5px 11px;font:12px monospace}section{padding:48px 0;border-bottom:1px solid #303030;scroll-margin-top:60px}.section-head{display:flex;justify-content:space-between;gap:20px;align-items:end;flex-wrap:wrap}.links{display:flex;gap:16px;flex-wrap:wrap;font-size:13px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px;margin-top:24px}.shot{background:#151515;border:1px solid #303030;border-radius:15px;overflow:hidden}.media{aspect-ratio:9/9;background:#050505;display:flex;justify-content:center;align-items:center}.media img,.media video{max-width:100%;max-height:100%;object-fit:contain}.body{padding:18px}.body p{min-height:3em}.badge{font:11px monospace;padding:5px 8px;border-radius:99px;background:#35302b;color:#f8caac;white-space:nowrap}.badge.done{background:#1e382f;color:#9de2ba}.badge.sent{background:#302d46;color:#c4bcff}.takes{font:12px/1.7 monospace;word-break:break-word}summary{cursor:pointer;color:#ee794e}.empty{border:1px dashed #555;padding:25px;border-radius:12px}footer{padding-top:30px;color:#777;font:12px monospace}@media(max-width:600px){.wrap{padding:20px 14px}.grid{grid-template-columns:1fr}.media{aspect-ratio:9/10}}'''
    document = f'''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Painel de produção · {html.escape(expert)}</title><style>{css}</style><div class="wrap"><header><div class="eyebrow">MATHEUS MARCOLINO / PRODUÇÃO VISUAL</div><h1>{html.escape(expert)}<br><span style="color:#ee794e">takes & shots.</span></h1><p class="intro">Estado local da produção em {stamp}. Cada cartão liga o take, a imagem inicial, a fala, o prompt e o clipe quando ele já foi baixado. "Enviado ao Flow" significa envio confirmado; não significa vídeo pronto. Reexecute o gerador após novas coletas para atualizar esta página.</p><div class="metrics">{summary}</div></header><nav>{nav}</nav>{''.join(sections)}<footer>PAINEL LOCAL · ESTADO DE PRODUÇÃO, NÃO PUBLICAÇÃO</footer></div><script>document.querySelectorAll('video').forEach(v=>v.addEventListener('play',()=>document.querySelectorAll('video').forEach(o=>{{if(o!==v)o.pause()}})));</script></html>'''
    output.write_text(document)
    manifest = output.with_suffix('.json')
    manifest.write_text(json.dumps({"schema": 1, "expert": expert, "generatedAt": stamp, "page": str(output), "references": records, "totals": dict(totals)}, ensure_ascii=False, indent=2) + '\n')
    return {"page": str(output), "manifest": str(manifest), "references": len(records), "totals": dict(totals)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--expert', required=True)
    parser.add_argument('--refs', nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(panel(args.expert, args.refs, args.output), ensure_ascii=False))
