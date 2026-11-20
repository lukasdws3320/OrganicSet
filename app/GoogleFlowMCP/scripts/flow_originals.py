#!/usr/bin/env python3
"""Original Flow media collector. Existing Harness IPC only; never submits generation.

The coordinator owns the UI. Do not run a live command concurrently with flow-control.
Selectors/menu details are deliberately installed only after observing the live DOM.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def downloaded_file(directory, timeout=90, interval=.4):
    """A dedicated empty directory makes attribution fail closed, without event-feed drains."""
    directory = Path(directory)
    deadline = time.monotonic() + timeout
    last = None
    stable = 0
    parcial = None
    parcial_desde = None
    while time.monotonic() < deadline:
        entries = list(directory.iterdir())
        pending = [p for p in entries if p.name.endswith((".crdownload", ".tmp", ".part"))]
        complete = [p for p in entries if p.is_file() and p not in pending and not p.name.startswith(".")]
        if len(complete) > 1:
            raise RuntimeError("More than one download appeared; attribution is ambiguous. No file was recorded.")
        # Windows (09/11/2026): o Chrome às vezes baixa tudo e não renomeia o .crdownload (antivírus segurando o
        # arquivo). Um único parcial com tamanho parado por 15 s é aceito; inspect_media/record_download ainda
        # exigem vídeo tocável e a duração planejada, então um arquivo truncado continua sendo recusado.
        if not complete and len(pending) == 1 and pending[0].stat().st_size > 0:
            atual = (pending[0].name, pending[0].stat().st_size)
            if atual != parcial:
                parcial, parcial_desde = atual, time.monotonic()
            elif time.monotonic() - parcial_desde >= 15:
                final = pending[0].with_name(pending[0].name[: -len(pending[0].suffix)])
                shutil.copy2(pending[0], final)
                return final
        if len(complete) == 1 and not pending:
            file = complete[0]
            if file.is_symlink():
                raise ValueError("Downloaded media cannot be a symbolic link")
            current = (file.name, file.stat().st_size, file.stat().st_mtime_ns)
            stable = stable + 1 if current == last else 0
            last = current
            if current[1] > 0 and stable >= 2:
                return file
        else:
            stable = 0
        time.sleep(interval)
    raise TimeoutError("Original download did not complete. Recover existing media; never submit generation again.")


def inspect_media(file, kind):
    file = Path(file)
    if file.is_symlink() or not file.is_file() or file.stat().st_size == 0:
        raise ValueError("Downloaded file is missing, empty or a symbolic link")
    if file.stat().st_size > 300 * 1024 * 1024:
        raise ValueError("Downloaded file exceeds 300 MB")
    head = file.read_bytes()[:32]
    image = ".png" if head.startswith(b"\x89PNG\r\n\x1a\n") else ".jpg" if head.startswith(b"\xff\xd8\xff") else ".webp" if head.startswith(b"RIFF") and head[8:12] == b"WEBP" else None
    video = ".mp4" if len(head) >= 12 and head[4:8] == b"ftyp" else ".webm" if head.startswith(b"\x1aE\xdf\xa3") else None
    extension = image if kind == "still" else video
    if not extension:
        raise ValueError("Downloaded bytes do not match the planned image/video kind; no file was recorded")
    result = {"extension": extension, "bytes": file.stat().st_size, "sha256": sha(file)}
    if kind == "shot":
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,duration", "-of", "json", str(file)], text=True, capture_output=True, check=True)
        data = json.loads(probe.stdout)
        stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
        if not stream or not float(data.get("format", {}).get("duration", 0)) > 0:
            raise ValueError("ffprobe did not confirm a playable video")
        result.update(measuredDuration=float(data["format"]["duration"]), width=stream.get("width"), height=stream.get("height"))
    return result


def record_download(args, file, media):
    from flow_plan import load_plan, run_plan, write_json
    plan, _ = load_plan(args.plan)
    root = Path(plan["outputDir"])
    row = next((x for x in plan["stills" if args.kind == "still" else "shots"] if x["id"] == args.item), None)
    if not row:
        raise ValueError("Unknown exact planned item")
    if args.kind == "shot" and abs(media.get("measuredDuration", 0) - row["duration"]) > .1:  # Veo entrega 7,93 s no preset de 8 s; presets vizinhos ficam a 2 s
        raise ValueError("Downloaded duration differs from the planned preset; recover the exact generation, never select an older same-prompt clip")
    if getattr(args, "candidate", False):
        directory = root / "candidates" / args.item
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / (args.asset_id + media["extension"])
        if not target.exists(): shutil.copy2(file, target)
        elif sha(target) != media["sha256"]: raise ValueError("Candidate file hash conflict")
        receipt = {"item":args.item,"kind":"candidate","assetId":args.asset_id,"pickerName":args.picker_name,"project":args.project,"file":str(target),"path":str(target),"humanApproved":False,**media}
        write_json(directory/(args.asset_id+".json"),receipt)
        return {"record":{"file":str(target),"status":"candidate","assetId":args.asset_id},"receipt":receipt}
    target = root / (args.item + (".still" if args.kind == "still" else ".shot") + media["extension"])
    if target.exists():
        if sha(target) != media["sha256"]:
            raise ValueError("Different output already exists; refusing overwrite")
    else:
        shutil.copy2(file, target)
    record = run_plan(SimpleNamespace(plan=args.plan, phase="record", kind=args.kind, item=args.item, file=str(target), asset_id=args.asset_id, picker_name=args.picker_name, project=args.project, quote=args.quote, approved=False))
    receipt = {"schema": "flow-original-download/v1", "item": args.item, "kind": args.kind, "assetId": args.asset_id, "pickerName": args.picker_name, "project": args.project, "path": str(target), "downloadedOriginal": True, "humanApproved": False, **media}
    if args.kind == "shot":
        receipt.update(sourceDuration=row["sourceDuration"], requestedDuration=row["requestedDuration"], selectedPreset=row["duration"], autoTrim=False)
    write_json(root / (args.item + ".download.json"), receipt)
    return {"record": record, "receipt": receipt}



def scan_images(flow):
    # Selector and ancestry were observed live by the coordinator, 21/10/2026.
    return flow.js("""(() => [...document.querySelectorAll('flow-image-tile img[data-media-id]')].map(e=>({assetId:e.getAttribute('data-media-id'),pickerName:e.closest('[aria-label]')?.getAttribute('aria-label')||'',loaded:e.complete&&e.naturalWidth>0,width:e.naturalWidth,height:e.naturalHeight,visible:!!e.getClientRects().length})))()""")


def verify_editor(flow, asset_id, project):
    from flow_plan import project_key
    from urllib.parse import urlparse
    import re
    observed = flow.js("location.href")
    parsed = urlparse(observed)
    found = re.fullmatch(r"/project/([^/]+)/edit/([^/]+)/?", parsed.path)
    if project_key(observed) != project_key(project) or not found or found.group(2) != asset_id:
        raise ValueError("Current editor is not the exact project/asset requested; no download clicked")
    return project_key(observed)


def record_only(args):
    # Useful when the coordinator performed the original download directly in the UI.
    file = Path(args.record_file)
    media = inspect_media(file, args.kind)
    return record_download(args, file, media)


def preflight(args):
    from flow_plan import load_plan, project_key, sha as plan_sha
    plan, plan_hash = load_plan(args.plan)
    root = Path(plan["outputDir"])
    if not root.is_absolute() or not root.is_dir():
        raise ValueError("Run plan preparation first; outputDir must already exist")
    row = next((x for x in plan["stills" if args.kind == "still" else "shots"] if x["id"] == args.item), None)
    if not row:
        raise ValueError("Unknown exact planned item")
    state = json.loads((root / "flow-run.json").read_text())
    if state.get("planSha256") != plan_hash:
        raise ValueError("Run belongs to another plan")
    if state.get("project") and state["project"] != project_key(args.project):
        raise ValueError("Project differs from recorded plan")
    prior = state.get("items", {}).get(args.item, {})
    if prior.get("status") == "available":
        existing = Path(prior.get("file", ""))
        if existing.is_file() and plan_sha(existing) == prior.get("sha256"):
            return root, {"reused": True, "record": prior}
        raise ValueError("Recorded output needs recovery; pass a new output directory or recover explicitly")
    known_quote = prior.get("quotedCredits")
    if known_quote is not None and args.quote is not None and known_quote != args.quote:
        raise ValueError("Known reserved quote cannot be changed")
    if known_quote is None and args.quote is None:
        raise ValueError("Pass --quote from the observed original submission; missing does not mean zero")
    if args.quote is None:
        args.quote = known_quote
    if args.quote < 0:
        raise ValueError("Invalid observed quote")
    return root, None


def collect(args):
    from flow_control import FlowControl
    from flow_plan import write_json
    root, reused = preflight(args)
    if reused:
        return reused
    flow = FlowControl()
    project = verify_editor(flow, args.editor_id, args.project)
    directory = Path(tempfile.mkdtemp(prefix=args.item + "-original-", dir=root))
    intent = {"schema": "flow-download-intent/v1", "item": args.item, "kind": args.kind, "editorId": args.editor_id, "assetId": args.asset_id, "pickerName": args.picker_name, "project": project, "directory": str(directory), "generationSubmitted": False, "time": time.time()}
    write_json(directory / ".intent.json", intent)
    original = "1K Original size" if args.kind == "still" else "720p Original size"
    flow.cdp("Page.setDownloadBehavior", behavior="allow", downloadPath=str(directory))
    try:
        controls = flow.ax()
        menu_open = any(not n.get("ignored") and n.get("role", {}).get("value") == "menuitem" and n.get("name", {}).get("value") == original for n in controls)
        if not menu_open:
            flow.click("button", "Download media")
        # These exact original/free options were observed in the live UI by the coordinator.
        # Never choose 2K/4K Upscaled or any other alternative when the original is absent.
        flow.click("menuitem", original)
        source = downloaded_file(directory, timeout=args.timeout)
        media = inspect_media(source, args.kind)
        result = record_download(args, source, media)
        result["receipt"]["editorId"] = args.editor_id
        result["receipt"]["originalMenuItem"] = original
        write_json(root / (args.item + ("."+args.asset_id if getattr(args,"candidate",False) else "") + ".download.json"), result["receipt"])
        write_json(directory / ".completed.json", {**intent, "sourceFile": str(source), **media})
        return result
    finally:
        # Restore normal browser download behavior; never touch browser profile/connection.
        flow.cdp("Page.setDownloadBehavior", behavior="default")


def self_test():
    import unittest
    class Tests(unittest.TestCase):
        def test_download_waits_for_stable_single_file(self):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "original.png"
                path.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
                self.assertEqual(downloaded_file(directory, timeout=1, interval=.005), path)
                self.assertEqual(inspect_media(path, "still")["extension"], ".png")
                with self.assertRaises(ValueError): inspect_media(path, "shot")
        def test_ambiguous_downloads_and_symlinks_are_not_accepted(self):
            with tempfile.TemporaryDirectory() as directory:
                for name in ["a.png", "b.png"]: (Path(directory)/name).write_bytes(b"fixture")
                with self.assertRaises(RuntimeError): downloaded_file(directory, timeout=.1, interval=.005)
                (Path(directory)/"b.png").unlink(); (Path(directory)/"a.png").unlink()
                (Path(directory)/"a.png").symlink_to("/tmp/nonexistent-flow-download")
                with self.assertRaises(TimeoutError): downloaded_file(directory, timeout=.02, interval=.005)
        def test_incomplete_download_times_out_without_retry(self):
            with tempfile.TemporaryDirectory() as directory:
                (Path(directory)/"file.crdownload").write_bytes(b"partial")
                with self.assertRaises(TimeoutError): downloaded_file(directory, timeout=.02, interval=.005)
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    return 0 if result.wasSuccessful() else 1


def main():
    import fcntl
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--scan-images", action="store_true", help="Read observed image tile IDs/names; never prints media URLs")
    parser.add_argument("--plan")
    parser.add_argument("--kind", choices=["still", "shot"])
    parser.add_argument("--item")
    parser.add_argument("--editor-id")
    parser.add_argument("--media-id", dest="asset_id")
    parser.add_argument("--picker-name")
    parser.add_argument("--project")
    parser.add_argument("--quote", type=int)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--record-file", help="Record a coordinator-downloaded original file without touching UI")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.scan_images:
        if not all([args.plan, args.kind, args.item, args.asset_id, args.picker_name, args.project]):
            parser.error("Supply --plan, --kind, --item, --media-id, --picker-name and --project")
        if not args.record_file and not args.editor_id:
            parser.error("Supply the observed --editor-id of the current editor")
        if args.timeout <= 0 or args.timeout > 300:
            parser.error("Use a timeout in (0,300] seconds")
    lock = Path.home() / ".config/google-flow-mcp/state/control-operation.lock"
    with lock.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another Flow control operation is active; no action retried")
        try:
            if args.scan_images:
                from flow_control import FlowControl
                result = {"images": scan_images(FlowControl()), "transport": "existing-harness-ipc"}
            elif args.record_file:
                _, reused = preflight(args)
                result = reused or record_only(args)
            else:
                result = collect(args)
            print(json.dumps(result, ensure_ascii=False))
            return 0
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": str(error), "generationRetried": False}, ensure_ascii=False))
        raise SystemExit(1)
