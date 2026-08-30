// ------------------------------------------------------------
// Busca de contato por NOME ou TELEFONE (seletor pesquisável, 2026-08-30).
//
// Módulo puro, irmão do `casaComABusca` do inbox — mas com uma diferença
// deliberada no telefone: aqui a comparação é DÍGITO contra DÍGITO. O
// operador digita "11 3178" ou "(27) 9283…" e o banco guarda "551131…";
// substring crua (o que o inbox faz) exigiria digitar exatamente como está
// gravado. `soDigitos` nas duas pontas torna a máscara irrelevante.
// ------------------------------------------------------------

import { semAcento } from '@/lib/inbox/busca-em-mensagens';

export interface ContatoPesquisavel {
  name: string | null;
  phone: string;
}

/** Só os dígitos — "+55 (11) 3178-4851" e "551131784851" viram comparáveis. */
function soDigitos(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * O termo casa com o contato quando o NOME (sem acento/caixa) contém o
 * termo, OU quando os dígitos do telefone contêm os dígitos do termo.
 *
 * ⚠️ O ramo do telefone só corre quando o termo TEM dígito: "ana" sem a
 * guarda viraria `""` depois do strip, e `includes("")` é verdadeiro para
 * todo telefone — a mesma armadilha da agulha vazia documentada no salto
 * da busca (`achados-no-fio`).
 */
export function casaComContato(
  contato: ContatoPesquisavel,
  termo: string
): boolean {
  const q = semAcento(termo.trim());
  if (!q) return true;

  if (semAcento(contato.name ?? '').includes(q)) return true;

  const digitosDoTermo = soDigitos(termo);
  return (
    digitosDoTermo.length > 0 &&
    soDigitos(contato.phone).includes(digitosDoTermo)
  );
}

/** A lista recortada pelo termo — vazio devolve todos, como todo filtro da casa. */
export function filtrarContatos<T extends ContatoPesquisavel>(
  contatos: T[],
  termo: string
): T[] {
  return contatos.filter((c) => casaComContato(c, termo));
}
