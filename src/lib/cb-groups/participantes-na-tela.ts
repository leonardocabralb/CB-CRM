// ============================================================
// A lista de participantes do lado do NAVEGADOR: a leitura da resposta de
// `GET /api/cb/groups/[id]/participantes` (JSON de fora, campo a campo) e a
// busca na lista. Puro, sem React.
// ============================================================

import type { CbGroup } from '@/types';

export type PapelNaTela = 'criador' | 'admin' | null;

export interface ParticipanteNaTela {
  id: string;
  nome: string | null;
  fonteDoNome: 'ficha' | 'grupo' | null;
  telefone: string | null;
  papel: PapelNaTela;
  somosNos: boolean;
  contatoId: string | null;
}

export interface RespostaDosParticipantes {
  participantes: ParticipanteNaTela[];
  /** Ao vivo: admin, ou o grupo deixa qualquer participante mudar os dados. */
  podeRenomear: boolean;
  /** `false` = qualquer participante muda o nome; `null` = não se sabe. */
  soAdminEdita: boolean | null;
  /** O espelho que a rota gravou (contagem, "somos admin?", nome), se gravou. */
  grupo: (Partial<CbGroup> & { id: string }) | null;
}

const textoOuNulo = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

function lerParticipante(bruto: unknown): ParticipanteNaTela | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const p = bruto as Record<string, unknown>;
  const id = textoOuNulo(p.id);
  if (!id) return null;
  const telefone = textoOuNulo(p.telefone);
  return {
    id,
    nome: textoOuNulo(p.nome),
    fonteDoNome: p.fonteDoNome === 'ficha' || p.fonteDoNome === 'grupo' ? p.fonteDoNome : null,
    // Só dígitos: vira `href`/pedido de conversa.
    telefone: telefone && /^\d{8,15}$/.test(telefone) ? telefone : null,
    papel: p.papel === 'criador' || p.papel === 'admin' ? p.papel : null,
    somosNos: p.somosNos === true,
    contatoId: textoOuNulo(p.contatoId),
  };
}

/**
 * Lê a resposta da rota. `null` = forma que não se entendeu (a tela trata
 * como falha, nunca como "nenhum participante").
 */
export function lerRespostaDosParticipantes(json: unknown): RespostaDosParticipantes | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r.participantes)) return null;
  const participantes = r.participantes
    .map(lerParticipante)
    .filter((p): p is ParticipanteNaTela => p !== null);
  if (!participantes.length) return null;
  const grupo =
    r.grupo && typeof r.grupo === 'object' && typeof (r.grupo as { id?: unknown }).id === 'string'
      ? (r.grupo as Partial<CbGroup> & { id: string })
      : null;
  return {
    participantes,
    podeRenomear: r.podeRenomear === true,
    soAdminEdita: typeof r.soAdminEdita === 'boolean' ? r.soAdminEdita : null,
    grupo,
  };
}

const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

/**
 * Busca na lista por nome (sem acento, sem caixa) ou por número (só os
 * dígitos do termo, com 3 ou mais). Termo vazio devolve a lista inteira.
 */
export function filtrarParticipantes(
  lista: ParticipanteNaTela[],
  termo: string,
): ParticipanteNaTela[] {
  const texto = semAcento(termo.trim());
  if (!texto) return lista;
  const digitos = termo.replace(/\D/g, '');
  return lista.filter(
    (p) =>
      (p.nome != null && semAcento(p.nome).includes(texto)) ||
      (digitos.length >= 3 && p.telefone != null && p.telefone.includes(digitos)),
  );
}
