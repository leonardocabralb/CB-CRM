// ============================================================
// Quem escreveu, na entrada da Meta — telefone OU BSUID (Fase 11.2).
//
// A Meta deixou de mandar o telefone de quem adotou nome de usuário e não
// tem histórico recente com a empresa: a mensagem chega só com
// `from_user_id` (o BSUID) e o `contacts[]` só com `user_id`. O original
// (#519) resolve isso em `wa-identity.ts`, que é arquivo DO UPSTREAM e fica
// intacto; a conversão para a NOSSA forma mora aqui:
//
//   · telefone ausente é `null`, nunca `''` — a ficha só-BSUID tem `phone`
//     NULO (P4, decisão do operador de 24/09/2026; o CHECK da 1041). `''`
//     passaria no CHECK, ficaria fora dos índices do telefone e faria nascer
//     uma ficha por mensagem;
//   · `from`/`wa_id` com LETRA não é telefone (um BSUID no lugar errado
//     viraria, pelos dígitos, o celular de um cliente);
//   · o nome é SÓ o do perfil. Nunca o `@` nem o BSUID (`identityDisplayName`
//     do original cai neles): o gatilho do título do card (1007/1008) os
//     leria como nome e CONGELARIA o card. Sem nome, a ficha nasce com `name`
//     nulo e o card "Novo contato" — o gatilho troca quando o nome chegar.
//
// Puro: a rota (`webhook/route.ts`) decide o que fazer com a identidade.
// ============================================================

import { normalizePhone } from './phone-utils'
import {
  resolveInboundIdentity,
  type WaContactPayload,
  type WaMessageIdentityPayload,
} from './wa-identity'

export interface IdentidadeNaEntrada {
  /** Só dígitos, ou `null` quando a Meta não mandou telefone. */
  telefone: string | null
  /** BSUID (`US.1349…`), ou `null`. É a chave que a Meta continua mandando. */
  waUserId: string | null
  /** BSUID do portfólio. Só referência, nunca chave de busca. */
  waParentUserId: string | null
  /** Nome de usuário, sem o `@`. Só exibição: a pessoa troca quando quer. */
  waUsername: string | null
  /** O nome do PERFIL, ou `null`. Nunca o `@` nem o BSUID. */
  nome: string | null
}

const TEM_LETRA = /[A-Za-z]/

/**
 * A identidade de uma mensagem com a entrada de `contacts[]` que é DELA (ver
 * `contatoDaMensagem`). Os campos da mensagem vencem os do `contacts[]`
 * quando os dois discordam, como no original.
 */
export function identidadeNaEntrada(
  mensagem: WaMessageIdentityPayload,
  contato?: WaContactPayload,
): IdentidadeNaEntrada {
  const original = resolveInboundIdentity(mensagem, contato)
  // A mesma fonte que o original lê (`from`, senão `wa_id`), conferida CRUA:
  // `normalizePhone` tira as letras e deixaria os dígitos de um BSUID.
  const bruto = mensagem.from ?? contato?.wa_id ?? ''
  return {
    telefone: TEM_LETRA.test(bruto) ? null : original.phone || null,
    waUserId: original.waUserId,
    waParentUserId: original.waParentUserId,
    waUsername: original.waUsername,
    nome: original.name || null,
  }
}

type Veredito = 'sim' | 'nao' | 'talvez'

/** A entrada de `contacts[]` é desta mensagem? Só pelo que dá para comparar. */
function veredito(mensagem: WaMessageIdentityPayload, contato: WaContactPayload): Veredito {
  let casou = false
  const bsuidDaMensagem = mensagem.from_user_id?.trim()
  const bsuidDoContato = contato.user_id?.trim()
  if (bsuidDaMensagem && bsuidDoContato) {
    if (bsuidDaMensagem !== bsuidDoContato) return 'nao'
    casou = true
  }
  const telefoneDaMensagem = normalizePhone(mensagem.from ?? '')
  const telefoneDoContato = normalizePhone(contato.wa_id ?? '')
  if (telefoneDaMensagem && telefoneDoContato) {
    if (telefoneDaMensagem !== telefoneDoContato) return 'nao'
    casou = true
  }
  return casou ? 'sim' : 'talvez'
}

/**
 * A entrada de `contacts[]` que pertence à mensagem da posição `posicao` —
 * pareada pela IDENTIDADE, não só pela posição.
 *
 * ⚠️ O original pareia por posição, com recuo para `contacts[0]`, e o
 * `resolveInboundIdentity` aproveita o `user_id` do `contacts[]` quando a
 * mensagem não traz `from_user_id`. Com duas pessoas no mesmo POST, o BSUID
 * (e o nome) de uma iria para a ficha da outra — e, como o preenchimento
 * do BSUID só escreve em branco (`.is('wa_user_id', null)`), para SEMPRE: as
 * mensagens só-BSUID da outra pessoa passariam a cair nessa ficha. Por isso:
 *   · entrada que CONTRADIZ a mensagem (outro BSUID, outro telefone) nunca é
 *     usada;
 *   · entrada que CASA vence, na posição ou em qualquer outra;
 *   · sem nada para comparar, só vale a entrada ÚNICA do POST.
 * Sem entrada nenhuma, a identidade sai só da mensagem (sem nome).
 */
export function contatoDaMensagem(
  mensagem: WaMessageIdentityPayload,
  contatos: WaContactPayload[] | undefined,
  posicao: number,
): WaContactPayload | undefined {
  const lista = contatos ?? []
  const naPosicao = lista[posicao]
  if (naPosicao && veredito(mensagem, naPosicao) === 'sim') return naPosicao
  const casou = lista.find((c) => veredito(mensagem, c) === 'sim')
  if (casou) return casou
  if (lista.length === 1 && veredito(mensagem, lista[0]) === 'talvez') return lista[0]
  return undefined
}
