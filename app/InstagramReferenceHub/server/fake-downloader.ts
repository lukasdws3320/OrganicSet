// Downloader falso para testes (IRH_DOWNLOADER=fake): gera mídia com ffmpeg, sem rede.
// Shortcodes com PRIVADO → privado; SUMIU → removido; FOTO → publicação sem vídeo; LENTO → demora 1,5 s.
// CARROSSEL → 3 imagens; CARROSSELMISTO → 2 vídeos + 1 imagem; CARROSSELPARCIAL → 4 slides, só o 1º e o 4º baixados.
import { join } from "node:path";
import { BIN, ImportError, run, type Downloaded, type DownloadedSlide, type Downloader, type PostInfo } from "./importer";
import { parseShortcode } from "./library";

function info(code: string, kind: PostInfo["kind"]): PostInfo {
  const n = [...code].reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    kind,
    username: "perfil_teste",
    display_name: "Perfil de Teste",
    caption: `Receita ${code} 👩‍🍳\n\n1️⃣ Misture\n2️⃣ Asse\n\nComente "TESTE" #receitafit`,
    published_at: "2026-09-01T12:00:00.000Z",
    views: null,
    likes: n * 10,
    comments: n,
    product_type: kind === "video" ? "clips" : kind === "carrossel" ? "carousel_container" : "feed",
  };
}

const hexOf = (code: string, i: number) => ((([...code].reduce((a, c) => a + c.charCodeAt(0), 0) + i * 47) % 200) + 30).toString(16).padStart(2, "0");

async function fakeImage(dir: string, code: string, i: number) {
  const file = join(dir, `${code}_${i + 1}.jpg`);
  await run([BIN.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x${hexOf(code, i)}4060:s=360x450`, "-frames:v", "1", file]);
  return file;
}

async function fakeVideo(dir: string, code: string, i: number) {
  const file = join(dir, `${code}_${i + 1}.mp4`);
  const hue = ([...code].reduce((a, c) => a + c.charCodeAt(0), 0) + i * 60) % 360;
  const r = await run([BIN.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=180x320:d=2:r=15,hue=h=${hue}`,
    "-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
  if (r.code !== 0) throw new ImportError(`ffmpeg falhou no fake: ${r.stderr}`);
  return file;
}

async function fakeCarousel(code: string, dir: string): Promise<Downloaded> {
  const plan: ("video" | "imagem" | "ausente")[] = code.includes("PARCIAL") ? ["imagem", "ausente", "ausente", "imagem"]
    : code.includes("MISTO") ? ["video", "video", "imagem"] : ["imagem", "imagem", "imagem"];
  const slides: DownloadedSlide[] = [];
  for (const [i, kind] of plan.entries()) {
    if (kind === "ausente") slides.push({ type: "imagem", file: null, thumb: null });
    else if (kind === "video") slides.push({ type: "video", file: await fakeVideo(dir, code, i), thumb: null });
    else slides.push({ type: "imagem", file: await fakeImage(dir, code, i), thumb: null });
  }
  const video = slides.find((s) => s.type === "video" && s.file)?.file ?? null;
  const image = slides.find((s) => s.type === "imagem" && s.file)?.file ?? null;
  return { info: info(code, "carrossel"), video, image, slides };
}

export const fakeDownloader: Downloader = {
  throttled: false,
  async download(url, dir) {
    const code = parseShortcode(url) ?? "x";
    if (code.includes("PRIVADO")) throw new ImportError("Publicação privada. — fake");
    if (code.includes("SUMIU")) throw new ImportError("Publicação indisponível ou removida. — fake");
    if (code.includes("LENTO")) await Bun.sleep(1500);
    const hue = [...code].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    if (code.includes("CARROSSEL")) return fakeCarousel(code, dir);
    if (code.includes("FOTO")) {
      const image = join(dir, `${code}.jpg`);
      await run([BIN.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=0x${(hue % 256).toString(16).padStart(2, "0")}4060:s=360x450`, "-frames:v", "1", image]);
      return { info: info(code, "imagem"), video: null, image };
    }
    const video = join(dir, `${code}.mp4`);
    const r = await run([BIN.ffmpeg, "-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=s=180x320:d=2:r=15,hue=h=${hue}`,
      "-f", "lavfi", "-i", "sine=f=440:d=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
    if (r.code !== 0) throw new ImportError(`ffmpeg falhou no fake: ${r.stderr}`);
    return { info: info(code, "video"), video, image: null };
  },
  async metrics(url) {
    const code = parseShortcode(url) ?? "x";
    const i = info(code, "video");
    return { ...i, likes: (i.likes ?? 0) + 1 };
  },
};
