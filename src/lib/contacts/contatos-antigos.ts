// ============================================================
// CONTATOS ANTIGOS (1092, D9): o telefone e o e-mail de uma ficha UNIDA a
// outra continuam encontrando a que ficou — mas SÓ NOS CADASTROS (decisão
// do operador, 13/10/2026): o formulário pela API v1, o Calendly, o webhook
// de entrada e a ficha criada pelo Asaas. Plano: docs/PLANO-fichas-duplicadas.md.
//
// ⚠️⚠️ NUNCA nos caminhos do WhatsApp (ingestão, envio, ligação) nem no passo
// de automação que manda para um número: a mensagem do número antigo abre
// ficha própria, e o aviso de possível duplicata (sinal 4 da 1092) a mostra
// ao lado da que ficou. Casar ali poria a conversa de quem herdou o número
// dentro da ficha de outra pessoa.
//
// ⚠️ Só DEPOIS da busca normal (`findExistingContact`) não achar ninguém: o
// contato antigo é a última tentativa antes de criar.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { telefoneCanonico } from './telefone';

/**
 * A ficha que tem este telefone ou e-mail como CONTATO ANTIGO e o MESMO
 * primeiro nome (`cb_ficha_por_contato_antigo`, que confere o nome: o número
 * digitado errado que virou contato antigo pode ser de outra pessoa). NULO =
 * nenhuma.
 *
 * ⚠️ Erro de banco ESTOURA, nunca vira "não achei": o cadastro seguiria
 * criando a ficha de novo — a duplicata que a união acabou de desfazer.
 */
export async function fichaPorContatoAntigo(
  db: SupabaseClient,
  accountId: string,
  alvo: {
    telefone?: string | null;
    email?: string | null;
    nome?: string | null;
  }
): Promise<string | null> {
  const telefone = alvo.telefone ? telefoneCanonico(alvo.telefone) : '';
  const email = alvo.email?.trim().toLowerCase() ?? '';
  // Sem nome o banco não casa ninguém (a régua do nome): poupa a ida.
  if ((!telefone && !email) || !alvo.nome?.trim()) return null;
  const { data, error } = await db.rpc('cb_ficha_por_contato_antigo', {
    p_conta: accountId,
    p_telefone_canonico: telefone || null,
    p_email: email || null,
    p_nome: alvo.nome,
  });
  if (error)
    throw new Error(`contatos antigos: a busca falhou (${error.message})`);
  return typeof data === 'string' && data !== '' ? data : null;
}
