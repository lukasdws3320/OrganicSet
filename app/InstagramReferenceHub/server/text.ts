// Funções puras de texto/links: usadas pelo servidor e pela interface (sem dependências de Node).

/** Chave dos experts nas replicações e painéis. Preserva o formato histórico com hífens. */
export const expertSlug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** ASCII minúsculo, sem acento, só [a-z0-9]. */
export function slugify(s: string | null | undefined, fallback = "geral"): string {
  const out = (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
  return out || fallback;
}

/**
 * Shortcode canônico de um link do Instagram.
 * Aceita /p/, /reel/, /reels/, /tv/, com ou sem /@perfil/ antes, query, hash e barra final,
 * e também sem https:// e sem www (instagram.com/reel/…).
 */
export function parseShortcode(input: string): string | null {
  let u: URL;
  try {
    const t = input.trim();
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$|^instagr\.am$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p.toLowerCase()));
  if (i < 0 || i > 1) return null; // no máximo um segmento de perfil antes
  const code = parts[i + 1];
  return code && /^[A-Za-z0-9_-]{5,}$/.test(code) ? code : null;
}

export const canonicalUrl = (code: string) => `https://www.instagram.com/p/${code}/`;

/** Extrai os links de um texto livre (colado ou CSV): http(s) e instagram.com/… sem https. A validade é decidida por parseShortcode. */
export function extractUrls(text: string): string[] {
  return [...text.matchAll(/(?:https?:\/\/|(?<![\w./@-])(?:(?:www|m)\.)?(?=instagram\.com\/|instagr\.am\/))[^\s"'<>;,]+/gi)]
    .map((m) => m[0].replace(/[.)\]→]+$/, ""));
}

/** Link de post no formato completo (https://www.instagram.com/…); outro texto volta como veio. */
export function normalizePostUrl(input: string): string {
  const t = input.trim();
  if (!t || /^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  return /^(?:(?:www|m)\.)?(instagram\.com|instagr\.am|tiktok\.com|youtube\.com|youtu\.be)\//i.test(t)
    ? `https://${t.replace(/^m\./i, "www.").replace(/^instagram\.com/i, "www.instagram.com")}` : t;
}

export function refId(month: string, seq: number) {
  return `REF-${month}-${String(seq).padStart(4, "0")}`;
}

export function videoFileName(id: string, username: string | null, category: string | null) {
  return `${id}_${slugify(username, "semusuario")}_${slugify(category)}.mp4`;
}

export const FILE_NAME_RE = /^REF-\d{4}-\d{2}-\d{4}_[a-z0-9]+_[a-z0-9]+\.mp4$/;

const COMMENT_VERB = "comente|comenta|comentem|comentar|comment|comments|mande|manda|envie|envia|digite|escreva|responda|responde";
/** Palavra solta depois do verbo que não é a palavra-chave. "mande para alguém" não é CTA "PARA". */
const CTA_STOP = new Set(["aqui", "abaixo", "embaixo", "para", "pra", "pro", "com", "que", "the", "a", "an", "o", "me", "you", "your", "if", "and", "this", "that", "to", "for", "my", "more", "down", "below", "here", "it", "so"]);

/** Palavra-chave de CTA. PT, EN e ES: Comente "LIVRO", Comment “YES”, comment KIDNEY, Comenta libro. */
export function extractCta(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const quoted = caption.match(new RegExp(String.raw`\b(?:${COMMENT_VERB})\b[^"“”'‘’\n]{0,50}["“'‘]([^"”'’\n]{1,30})["”'’]`, "i"));
  if (quoted) return quoted[1].trim().toUpperCase();
  // Série sem palavra entre aspas: "Comenta aqui com um emojizinho qualquer".
  if (/\bcoment\w*\b[^\n]{0,80}\b(?:emoji\w*|qualquer)\b/i.test(caption)) return "QUALQUER";
  const bare = caption.match(new RegExp(String.raw`\b(?:${COMMENT_VERB})\s+((?:eu\s+)?\p{L}{2,20})`, "iu"));
  if (bare && !CTA_STOP.has(bare[1].toLowerCase())) return bare[1].trim().toUpperCase();
  return null;
}

export interface CtaAction { kind: string; label: string; detail?: string }

/** Toda CTA escrita na legenda. Só entra o que o texto diz; silêncio vira lista vazia. */
export function extractCtaActions(caption: string | null | undefined): CtaAction[] {
  if (!caption) return [];
  const out: CtaAction[] = [];
  const keyword = extractCta(caption);
  if (keyword === "QUALQUER") out.push({ kind: "comentar", label: "Comentar", detail: "qualquer emoji" });
  else if (keyword) out.push({ kind: "comentar", label: "Comentar", detail: keyword });
  if (/\b(?:no privado|na dm|no dm|mensagem direta)\b/i.test(caption) || /\b(?:dm|dms)\b/i.test(caption)) out.push({ kind: "dm", label: "Mensagem direta" });
  if (/link (?:azul )?(?:na|da|in(?: the)?) bio/i.test(caption)) out.push({ kind: "bio", label: "Link na bio" });
  if (/\bsalv(?:ar|a|e)\b/i.test(caption) || /\bsave (?:this|it|for)\b/i.test(caption)) out.push({ kind: "salvar", label: "Salvar" });
  if (/\b(?:siga|segue|seguindo|seguir|follow|sigueme|sígueme)\b/i.test(caption)) out.push({ kind: "seguir", label: "Seguir" });
  if (/\bcompartilh|\b(?:mande|manda) para\b|\bshare (?:this|it)\b/i.test(caption)) out.push({ kind: "compartilhar", label: "Compartilhar" });
  if (/\b(?:curte|curtir|deixe o like|deixe um like|d[aá] um like|double tap)\b/i.test(caption)) out.push({ kind: "curtir", label: "Curtir" });
  const cupom = caption.match(/cupom[^\n]{0,24}?([A-Za-z]{3,})/i);
  if (cupom) out.push({ kind: "cupom", label: "Cupom", detail: cupom[1].toUpperCase() });
  if (/\bvocê faria\b|\bnos comentários\b/i.test(caption)) out.push({ kind: "pergunta", label: "Pergunta no comentário" });
  if (/\bfixad|\bir lá conferir\b/i.test(caption)) out.push({ kind: "assistir", label: "Assistir o vídeo anterior" });
  return out;
}

export function extractHashtags(caption: string | null | undefined): string {
  if (!caption) return "";
  return [...new Set([...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase()))].join(" ");
}
