// ============================================================
// CONTATOS ANTIGOS (1092, D9): o TELEFONE de uma ficha UNIDA a outra
// continua encontrando a que ficou — mas SÓ NOS CADASTROS (decisão do
// operador, 13/10/2026): o formulário pela API v1, o Calendly, o webhook de
// entrada e a ficha criada pelo Asaas. E na busca `?search=` da API v1
// (14/10/2026), pelo mesmo motivo: quem integra procura a pessoa pelo número
// que guardou. Plano: docs/PLANO-fichas-duplicadas.md.
//
// ⚠️ SÓ O TELEFONE (D9 refinada, 14/10/2026; a RPC perdeu o `p_email` na
// 1093). Nenhum cadastro procura a ficha pelo e-mail ATUAL (só pelo
// telefone, `findExistingContact`), então o e-mail ANTIGO também não a
// encontra: ele só acende o aviso de possível duplicata (sinal 4 da 1092).
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

import { literalParaRegex } from '@/lib/postgrest/literal';

import { telefoneCanonico } from './telefone';

/**
 * A ficha que tem este telefone como CONTATO ANTIGO e o MESMO primeiro nome
 * (`cb_ficha_por_contato_antigo`, que confere o nome: o número digitado
 * errado que virou contato antigo pode ser de outra pessoa). NULO = nenhuma.
 *
 * ⚠️ Os argumentos são EXATAMENTE os três da 1093: o PostgREST escolhe a
 * função pelos NOMES dos argumentos, e um a mais (o `p_email` da 1092) não
 * casa com ela — a busca falharia em todo cadastro.
 *
 * ⚠️ Erro de banco ESTOURA, nunca vira "não achei": o cadastro seguiria
 * criando a ficha de novo — a duplicata que a união acabou de desfazer.
 */
export async function fichaPorContatoAntigo(
  db: SupabaseClient,
  accountId: string,
  alvo: {
    telefone?: string | null;
    nome?: string | null;
  }
): Promise<string | null> {
  const telefone = alvo.telefone ? telefoneCanonico(alvo.telefone) : '';
  // Sem telefone não há o que procurar, e sem nome o banco não casa ninguém
  // (a régua do nome): poupa a ida.
  if (!telefone || !alvo.nome?.trim()) return null;
  const { data, error } = await db.rpc('cb_ficha_por_contato_antigo', {
    p_conta: accountId,
    p_telefone_canonico: telefone,
    p_nome: alvo.nome,
  });
  if (error)
    throw new Error(`contatos antigos: a busca falhou (${error.message})`);
  return typeof data === 'string' && data !== '' ? data : null;
}

/**
 * Menos dígitos que isto não procuram telefone antigo. Oito é o número do
 * assinante (o que sobra sem DDI, DDD e nono dígito): o menor pedaço que
 * IDENTIFICA um número — a mesma tolerância de `findExistingContact` — e o
 * que o Make de quem integra manda. Com menos, o pedaço deixa de apontar uma
 * pessoa ("5583" é o DDD inteiro) e traria telefones antigos de gente que não
 * tem nada com a busca.
 */
const DIGITOS_MINIMOS_DA_BUSCA = 8;

/**
 * Teto de fichas: os ids vão na URL do PostgREST (`id.in.(…)`), e cem UUIDs
 * é a régua de `IDS_POR_CONSULTA` (`use-broadcast-sending.ts`), folgada sob
 * os ~8 KB que proxy e PostgREST aceitam. Com 8 dígitos ou mais, cem fichas
 * com o mesmo pedaço não acontecem na prática; se acontecerem, ficam as
 * uniões mais RECENTES.
 */
const TETO_DA_BUSCA = 100;

/**
 * As fichas que têm um TELEFONE ANTIGO contendo o termo da busca de
 * `GET /api/v1/contacts?search=` (decisão do operador, 14/10/2026: o Make de
 * quem integra procura o contato pelos 8 últimos dígitos e desliga no
 * primeiro erro, e depois de uma união o número que ele guardou pode ser o da
 * ficha que SAIU). Vazio = nenhuma.
 *
 * Só termo feito SÓ DE DÍGITOS, com 8 ou mais — o resto devolve vazio sem ir
 * ao banco. É a régua que a doc pública dá para o telefone ("busque pelos
 * dígitos": "+55 (81)" não acha nada no telefone atual, e não pode achar no
 * antigo); e "Ana 99998888" não pode trazer, pelos dígitos, a ficha de outra
 * pessoa. O termo passa pela MESMA régua canônica do valor guardado
 * (`telefoneCanonico`): o número completo de 12 dígitos, sem o nono, acha o
 * antigo que foi guardado com ele.
 *
 * ⚠️ Erro de banco ESTOURA: a busca diria "não achei" sobre a ficha que
 * existe, e o integrador a criaria de novo.
 */
export async function fichasPeloTelefoneAntigo(
  db: SupabaseClient,
  accountId: string,
  termo: string
): Promise<string[]> {
  if (!/^\d+$/.test(termo) || termo.length < DIGITOS_MINIMOS_DA_BUSCA) return [];
  // Só dígitos: o escape não muda nada, mas a busca nova passa pelo módulo
  // de texto literal como as outras (`.claude/rules/contatos.md`).
  const { data, error } = await db
    .from('cb_contatos_antigos')
    .select('contact_id')
    .eq('account_id', accountId)
    .eq('tipo', 'telefone')
    .regexIMatch('valor', literalParaRegex(telefoneCanonico(termo)))
    .order('created_at', { ascending: false })
    .limit(TETO_DA_BUSCA);
  if (error)
    throw new Error(
      `contatos antigos: a busca pelo telefone falhou (${error.message})`
    );
  return [
    ...new Set(
      (data ?? []).flatMap((l) =>
        typeof l.contact_id === 'string' ? [l.contact_id] : []
      )
    ),
  ];
}
