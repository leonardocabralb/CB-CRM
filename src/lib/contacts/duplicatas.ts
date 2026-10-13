// ============================================================
// Possível duplicata (1084): a regra pura do lado da tela.
//
// QUEM decide que duas fichas parecem a mesma pessoa é o banco
// (`cb_possiveis_duplicatas`, conferida na hora em que a conversa ou o card
// abre). Aqui só se lê o que ele devolveu — JSON de fora, campo a campo — e
// se monta a lista da faixa. Plano e medição: docs/PLANO-fichas-duplicadas.md.
// ============================================================

/** Um motivo do par, como o banco o escreve (`motivos` da RPC). */
export type MotivoDaDuplicata =
  | { tipo: "mesmo_email" }
  | { tipo: "telefone_parecido" }
  | { tipo: "criadas_juntas"; segundos: number };

/** A linha da RPC, crua. */
export interface CandidataGravada {
  outro_id: string;
  motivos: unknown;
}

/** Só o que a faixa desenha da outra ficha. */
export interface FichaDaCandidata {
  id: string;
  name: string | null;
  /** NULO na ficha só do Instagram (989) ou só-BSUID (1041). */
  phone: string | null;
  wa_username?: string | null;
  instagram_username?: string | null;
  created_at: string;
}

/** Uma ficha que parece ser a mesma pessoa, pronta para a faixa. */
export interface Candidata {
  contatoId: string;
  /**
   * NULO quando a ficha não veio na leitura (apagada entre a RPC e a busca).
   * A faixa diz "Ficha não encontrada", com o "Comparar" desabilitado, em vez
   * de sumir com a linha.
   */
  ficha: FichaDaCandidata | null;
  motivos: MotivoDaDuplicata[];
}

/**
 * Lê `motivos` defensivamente: tipo desconhecido (um sinal novo no banco
 * antes do app) é IGNORADO, nunca vira texto cru na tela; segundos que não
 * são número viram 0.
 */
export function lerMotivos(bruto: unknown): MotivoDaDuplicata[] {
  if (!Array.isArray(bruto)) return [];
  const motivos: MotivoDaDuplicata[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object") continue;
    const tipo = (item as { tipo?: unknown }).tipo;
    if (tipo === "mesmo_email" || tipo === "telefone_parecido") {
      motivos.push({ tipo });
    } else if (tipo === "criadas_juntas") {
      const s = Number((item as { segundos?: unknown }).segundos);
      motivos.push({ tipo, segundos: Number.isFinite(s) && s >= 0 ? Math.round(s) : 0 });
    }
  }
  return motivos;
}

/**
 * Junta as leituras (RPC e fichas) na lista da faixa, na ordem da RPC (a
 * mais forte primeiro). Linha sem NENHUM motivo legível sai: aviso sem
 * motivo não diz nada a ninguém. A conversa da outra ficha é lida só no
 * "Comparar", com o recorte do perfil.
 */
export function montarCandidatas(linhas: CandidataGravada[], fichas: FichaDaCandidata[]): Candidata[] {
  const fichaPorId = new Map(fichas.map((f) => [f.id, f]));
  const candidatas: Candidata[] = [];
  for (const linha of linhas) {
    const motivos = lerMotivos(linha.motivos);
    if (motivos.length === 0) continue;
    candidatas.push({
      contatoId: linha.outro_id,
      ficha: fichaPorId.get(linha.outro_id) ?? null,
      motivos,
    });
  }
  return candidatas;
}

/**
 * O par como `cb_duplicatas_descartadas` o guarda: (menor, maior).
 *
 * ⚠️ O CHECK do banco compara `uuid`, que ordena pelos bytes — a mesma ordem
 * do texto em hexadecimal MINÚSCULO. Por isso as duas pontas descem para
 * minúsculas antes de comparar: um id em maiúsculas inverteria o par e o
 * INSERT levaria 23514.
 */
export function parOrdenado(a: string, b: string): { contato_menor: string; contato_maior: string } {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? { contato_menor: x, contato_maior: y } : { contato_menor: y, contato_maior: x };
}

/**
 * O intervalo entre as duas fichas para a frase "criadas com … de
 * diferença": segundos abaixo de um minuto, minutos (arredondados) acima.
 * A janela do banco é de 2 min, então nunca passa de "2 min".
 */
export function intervaloEntreAsFichas(segundos: number): { unidade: "segundos" | "minutos"; valor: number } {
  if (segundos < 60) return { unidade: "segundos", valor: Math.max(0, Math.round(segundos)) };
  return { unidade: "minutos", valor: Math.round(segundos / 60) };
}
