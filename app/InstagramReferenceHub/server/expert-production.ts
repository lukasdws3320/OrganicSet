import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export type ExpertProduction = {
  schema: "expert-flow-profile/v1"; expertSlug: string; expertName: string; avatarName: string;
  contactSheet: { path: string; sha256: string };
  presentation?: {voiceDirection:string;source:string};
  /** Só no formato TROCA DE PRODUTO: o contact sheet é a foto do produto novo. */
  produto?: {original:string;novo:string;texto:string};
  /** Alteração pontual (substitui "produto"): tipo objeto | adicionar | roupa | avatar | cenario. Ver replicacao-prompts.ts. */
  alteracao?: import("./replicacao-prompts").Alteracao;
  /** Idioma da fala quando o perfil não é PT-BR (ex.: "inglês dos Estados Unidos"). */
  idiomaFala?: string;
  audio?: { mode: "generated" | "post-production" | "silent"; voiceBinding: "required" | "best-effort" | "none"; allowInvalidMention: boolean };
  flow: { projectName: string; projectUrl: string; videoModel: string; videoMode: "Frames" | "Ingredients";
    aspectRatio: "9:16" | "16:9"; resolution: string; count: 1; imageModel?: string;
    voiceMention?: { authorizedByUser: boolean; id: string; display: string; option: string; note?: string };
    voiceOption?: string };
};

/** Expert-owned data; this module has no default expert, avatar, voice or project. */
export function loadExpertIdentity(root: string, rep: { slug: string; expert: string; avatar: string }) {
  if (!/^[a-z0-9-]+$/.test(rep.slug)) throw Error("Slug do expert inválido");
  const file = join(root, "experts", rep.slug, "producao.json");
  if (!existsSync(file)) return null;
  const profile = JSON.parse(readFileSync(file, "utf8")) as ExpertProduction;
  if (profile.schema !== "expert-flow-profile/v1" || profile.expertSlug !== rep.slug)
    throw Error("Perfil de produção pertence a outro expert");
  if (profile.avatarName !== rep.avatar) throw Error("O avatar do perfil diverge do avatar cadastrado na replicação");
  if (!isAbsolute(profile.contactSheet?.path || "")) throw Error("Contact sheet precisa de caminho absoluto");
  const sheet = realpathSync(profile.contactSheet.path);
  const hash = createHash("sha256").update(readFileSync(sheet)).digest("hex");
  if (hash !== profile.contactSheet.sha256) throw Error("Contact sheet com hash alterado; conferir a identidade antes de gerar");
  return { profile: { ...profile, expertName: rep.expert }, contactSheet: { ...profile.contactSheet, path: sheet } };
}

export function loadExpertProduction(root: string, rep: { slug: string; expert: string; avatar: string }): ExpertProduction | null {
  const identity = loadExpertIdentity(root, rep);
  if (!identity) return null;
  const { profile } = identity;
  const flow = profile.flow;
  if (!flow?.projectName?.trim() || !/^https:\/\/flow\.google\.com\/project\/[A-Za-z0-9-]+$/.test(flow.projectUrl || ""))
    throw Error("Projeto Flow do expert não está vinculado");
  if (!flow.videoModel?.trim() || !["Frames", "Ingredients"].includes(flow.videoMode) || flow.count !== 1 || !["9:16", "16:9"].includes(flow.aspectRatio))
    throw Error("Configuração de geração do expert inválida");
  if (flow.voiceMention && (!/^voices\/[A-Za-z0-9_-]+$/.test(flow.voiceMention.id) || !flow.voiceMention.display || !flow.voiceMention.option))
    throw Error("Voz mencionada sem ID, nome ou opção exata");
  if (profile.audio) {
    const a = profile.audio, hasVoice = !!(flow.voiceMention || flow.voiceOption);
    if (!["generated", "post-production", "silent"].includes(a.mode) || !["required", "best-effort", "none"].includes(a.voiceBinding) || typeof a.allowInvalidMention !== "boolean")
      throw Error("Política de áudio inválida");
    if (a.voiceBinding === "required" && (!hasVoice || a.allowInvalidMention)) throw Error("Voz obrigatória precisa de vínculo explícito e não permite menção inválida");
    if ((a.mode !== "generated" || a.voiceBinding === "none") && hasVoice) throw Error("Política de áudio diverge da seleção de voz");
  }
  return { ...profile, contactSheet: identity.contactSheet };
}
