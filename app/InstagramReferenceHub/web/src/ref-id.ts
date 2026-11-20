const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Dígitos de um ID digitado: "0163" | "ref0163" | "REF-0163" | "REF-2026-10-0163" → "0163". */
export function idDigits(q: string): string | null {
  const m = norm(q).replace(/\s+/g, "").match(/^(?:ref)?-?(?:\d{4}-\d{2}-)?(\d{2,4})$/);
  return m ? m[1] : null;
}

/** ID completo acha só aquele mês; número solto acha todos os meses (exatos antes dos parciais). */
export function refsPorId<T extends { id: string; legacy_id?: string | null }>(all: T[], q: string): T[] {
  const dig = idDigits(q);
  if (!dig) return [];
  const pad = dig.padStart(4, "0");
  const mes = norm(q).replace(/\s+/g, "").match(/(\d{4}-\d{2})-\d{2,4}$/)?.[1];
  if (mes) return all.filter((r) => r.id === `REF-${mes}-${pad}`);
  const exatos = all.filter((r) => r.id.endsWith(`-${pad}`) || norm(r.legacy_id ?? "") === `ref${pad}`);
  return [...exatos, ...all.filter((r) => !exatos.includes(r) && r.id.slice(-4).includes(dig)).slice(0, 6)];
}
