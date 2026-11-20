import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Catálogo de prompts de geração (foto/vídeo) herdado da OP 001.
 *
 * O catálogo é versionado no repo (`prompts/catalogo.json`) — ele é conteúdo, não
 * dado do usuário. O que o Matheus faz na interface (favoritar, registrar uso) vai
 * para `library/prompts-estado.json`, fora do git, junto do resto da biblioteca.
 */

const CATALOGO = resolve(import.meta.dir, "..", "prompts", "catalogo.json");
const EXEMPLOS = resolve(import.meta.dir, "..", "prompts", "exemplos.json");

export type Midia = "foto" | "video" | "receita";

export type PromptItem = {
  id: string;
  titulo: string;
  midia: Midia;
  familia: string;
  tag: string;
  tipo: "prompt" | "template";
  status: string;
  motor: string;
  uso: string;
  notas: string[];
  blocos: string[];
  arquivo: string;
};

type Catalogo = {
  versao: number;
  atualizado_em: string;
  origem: { rotulo: string; pasta: string; vault: string };
  aviso: string;
  prompts: PromptItem[];
};

type Estado = Record<string, { favorito?: boolean; usos?: number; ultimo_uso?: string }>;

const estadoPath = (root: string) => join(root, "prompts-estado.json");

function lerEstado(root: string): Estado {
  const p = estadoPath(root);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function gravarEstado(root: string, e: Estado) {
  writeFileSync(estadoPath(root), JSON.stringify(e, null, 2), "utf8");
}

function lerCatalogo(): Catalogo {
  return JSON.parse(readFileSync(CATALOGO, "utf8"));
}

type Exemplo = {
  necessidade: string;
  entradas: string[];
  trecho: string;
  resultado: string;
  atencao?: string;
};

type Curadoria = {
  objetivos: { id: string; titulo: string; descricao: string }[];
  atribuicao: Record<string, string>;
  exemplos: Record<string, Exemplo>;
};

function lerCuradoria(): Curadoria {
  if (!existsSync(EXEMPLOS)) return { objetivos: [], atribuicao: {}, exemplos: {} };
  return JSON.parse(readFileSync(EXEMPLOS, "utf8"));
}

export function listarPrompts(root: string) {
  const cat = lerCatalogo();
  const cur = lerCuradoria();
  const est = lerEstado(root);
  const prompts = cat.prompts.map((p) => ({
    ...p,
    objetivo: cur.atribuicao[p.id] ?? "molde",
    exemplo: cur.exemplos[p.id] ?? null,
    favorito: !!est[p.id]?.favorito,
    usos: est[p.id]?.usos ?? 0,
    ultimo_uso: est[p.id]?.ultimo_uso ?? null,
  }));
  const familias = [...new Set(prompts.map((p) => p.familia))];
  const contagem = new Map<string, number>();
  for (const p of prompts) contagem.set(p.objetivo, (contagem.get(p.objetivo) ?? 0) + 1);
  const objetivos = cur.objetivos.map((o) => ({ ...o, total: contagem.get(o.id) ?? 0 }));
  return {
    versao: cat.versao,
    atualizado_em: cat.atualizado_em,
    origem: cat.origem,
    aviso: cat.aviso,
    total: prompts.length,
    favoritos: prompts.filter((p) => p.favorito).length,
    familias,
    objetivos,
    prompts,
  };
}

export function marcarFavorito(root: string, id: string, valor?: boolean) {
  const cat = lerCatalogo();
  const item = cat.prompts.find((p) => p.id === id);
  if (!item) return null;
  const est = lerEstado(root);
  const atual = est[id] ?? {};
  est[id] = { ...atual, favorito: valor ?? !atual.favorito };
  gravarEstado(root, est);
  return { id, favorito: !!est[id].favorito };
}

/** Registra que o prompt foi usado: contador + data ISO. Alimenta o acompanhamento. */
export function registrarUso(root: string, id: string) {
  const cat = lerCatalogo();
  const item = cat.prompts.find((p) => p.id === id);
  if (!item) return null;
  const est = lerEstado(root);
  const atual = est[id] ?? {};
  est[id] = { ...atual, usos: (atual.usos ?? 0) + 1, ultimo_uso: new Date().toISOString() };
  gravarEstado(root, est);
  return { id, usos: est[id].usos!, ultimo_uso: est[id].ultimo_uso! };
}

/** Markdown de um prompt, para colar direto no Obsidian. */
export function markdownPrompt(id: string): string | null {
  const cat = lerCatalogo();
  const p = cat.prompts.find((x) => x.id === id);
  if (!p) return null;
  const corpo = p.blocos.map((b) => "```\n" + b + "\n```").join("\n\n");
  return `## ${p.id} · ${p.titulo}\n\n**Uso:** ${p.uso}\n\n${corpo}\n`;
}
