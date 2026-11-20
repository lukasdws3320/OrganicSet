import { Hoje } from "./Hoje";

/**
 * O Dashboard antigo (refração + 191 CTAs) foi substituído pela tela Hoje (SPEC §5.2).
 * Mantido como alias para quem ainda importa `Dashboard`.
 */
export function Dashboard() {
  return <Hoje />;
}
