// ============================================================
// Acervo de mídias (953) — recorte da lista, puro e testável.
//
// Mora fora da tela porque as DUAS telas filtram: a de Configurações, onde o
// admin monta o acervo, e o seletor do compositor, onde o atendente procura
// com o cliente esperando. Duas cópias divergiriam, e a divergência apareceria
// como "achei pelo painel e não acho na hora de enviar".
// ============================================================

import type { TipoDeMidia } from './tipos';

export interface ItemFiltravel {
  titulo: string;
  categoria: string | null;
  filename: string;
  tipo: TipoDeMidia;
}

export interface FiltroDoAcervo {
  termo?: string;
  /** `null`/ausente = todas. */
  categoria?: string | null;
  /** `null`/ausente = todos. */
  tipo?: TipoDeMidia | null;
}

/**
 * Sem acento e em minúsculas, para "contrato" achar "Contrato" e "honorarios"
 * achar "honorários".
 *
 * ⚠️ `\p{Mn}` (marca sem avanço), nunca `\p{Diacritic}`: a segunda faixa
 * inclui o acento que existe SOZINHO (`^`, `´`, `~`), e buscar `^^^` viraria
 * agulha vazia — `includes("")` é verdadeiro para tudo, e a lista inteira
 * apareceria como se casasse. É a mesma armadilha já documentada na busca do
 * fio (`achados-no-fio.ts`).
 */
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

/**
 * As categorias em uso, em ordem alfabética. Item sem categoria não entra —
 * quem exibe decide como chamar o resto ("Geral"), e devolver um `null` no
 * meio da lista obrigaria todo call site a tratá-lo.
 */
export function categoriasDe(itens: readonly ItemFiltravel[]): string[] {
  const vistas = new Map<string, string>();
  for (const item of itens) {
    const c = item.categoria?.trim();
    if (!c) continue;
    // Chaveia normalizado para "Contratos" e "contratos" não virarem duas
    // abas; o rótulo exibido é o primeiro que apareceu.
    const chave = semAcento(c);
    if (!vistas.has(chave)) vistas.set(chave, c);
  }
  return [...vistas.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

/**
 * Aplica termo + categoria + tipo. Filtro vazio devolve tudo — a convenção do
 * projeto inteiro ("escopo vazio = todos"), e o que o seletor mostra ao abrir.
 *
 * O termo casa no TÍTULO e no NOME DO ARQUIVO: o operador batizou o item, mas
 * quem subiu lembra do nome do PDF, e procurar por ele e não achar faz a
 * pessoa subir uma segunda cópia.
 */
export function filtrarAcervo<T extends ItemFiltravel>(
  itens: readonly T[],
  filtro: FiltroDoAcervo = {}
): T[] {
  const termo = semAcento(filtro.termo?.trim() ?? '');
  const categoria = filtro.categoria?.trim()
    ? semAcento(filtro.categoria.trim())
    : null;
  const tipo = filtro.tipo ?? null;

  return itens.filter((item) => {
    if (tipo && item.tipo !== tipo) return false;
    if (categoria !== null) {
      const c = item.categoria?.trim();
      if (!c || semAcento(c) !== categoria) return false;
    }
    if (termo) {
      const alvo = `${semAcento(item.titulo)} ${semAcento(item.filename)}`;
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/** Tamanho legível para a lista ("1,4 MB"). */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
