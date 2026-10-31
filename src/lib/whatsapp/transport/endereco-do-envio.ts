// ============================================================
// O endereço (JID) onde a mensagem que ENVIAMOS pela Evolution vive no
// WhatsApp — o que se grava em `messages.remote_jid`/`remote_jid_lid` e por
// onde, depois, se apaga, edita e reage.
//
// ⚠️ O telefone da FICHA não serve de endereço. A Evolution confere o número
// no WhatsApp antes de enviar (`whatsappNumber` → `onWhatsApp`, testando as
// duas grafias do nono dígito) e manda para o endereço que EXISTE — o número
// antigo de DDD 31 em diante vive SEM o 9. Já o apagar
// (`chat/deleteMessageForEveryone`) usa o JID que mandamos, cru: com o
// telefone da ficha, a revogação ia para uma conversa que não existe, a
// Evolution respondia 2xx e a mensagem seguia no aparelho do cliente.
// Medido em 19/10/2026: 3 de 11 exclusões pedidas em 30 dias, e ~23% das
// mensagens enviadas pelo CRM no mesmo período, com o endereço errado.
//
// A resposta do envio traz `key.remoteJid`, o endereço que ela USOU: é ele
// que se grava (`enderecoDoEnvio`). O que foi gravado antes disso é
// corrigido na hora de agir pela grafia que o CLIENTE usa na conversa
// (`jidDoClienteNaOutraGrafia`).
// ============================================================

import { variantesDoNonoDigito } from '@/lib/contacts/telefone';
import { toEvolutionNumber } from './evolution-transport';

/** As colunas da chave Baileys que o envio grava. */
export interface EnderecoDoEnvio {
  /** `…@s.whatsapp.net`: identifica a conversa e, sem LID, é o endereço. */
  remoteJid: string;
  /** `…@lid` quando a Evolution enviou pelo LID: é por ele que se revoga. */
  remoteJidLid: string | null;
}

const JID_DE_TELEFONE = /^\d+@s\.whatsapp\.net$/;
const JID_DE_LID = /^\d+@lid$/;

/**
 * O endereço a gravar para uma mensagem 1:1 enviada pela Evolution.
 *
 * - `jidUsado` de telefone: é ele (pode diferir de `alvo` no nono dígito, e
 *   essa diferença é o motivo deste arquivo).
 * - `jidUsado` em LID: vai para `remote_jid_lid` (a rota de apagar o prefere),
 *   e `remote_jid` fica com o telefone — é por ele que a conversa é
 *   reconhecida, e o LID jamais ocupa o lugar do telefone.
 * - Sem `jidUsado` (resposta sem a chave) ou numa forma que não reconhecemos:
 *   o telefone da ficha, como era antes.
 */
export function enderecoDoEnvio(
  jidUsado: string | null | undefined,
  alvo: string,
): EnderecoDoEnvio {
  const daFicha = `${toEvolutionNumber(alvo)}@s.whatsapp.net`;
  if (jidUsado && JID_DE_TELEFONE.test(jidUsado)) {
    return { remoteJid: jidUsado, remoteJidLid: null };
  }
  if (jidUsado && JID_DE_LID.test(jidUsado)) {
    return { remoteJid: daFicha, remoteJidLid: jidUsado };
  }
  return { remoteJid: daFicha, remoteJidLid: null };
}

/**
 * Para a mensagem gravada com o telefone da ficha (antes de
 * `enderecoDoEnvio`): o JID que o CLIENTE usa na conversa, quando ele é a
 * outra grafia do nono dígito do que foi gravado. É o endereço onde a
 * mensagem vive no WhatsApp.
 *
 * Qualquer outra diferença devolve `null` (fica o gravado): número diferente
 * de verdade não é a mesma pessoa, e trocar o endereço mandaria a revogação
 * para a conversa de outro.
 */
export function jidDoClienteNaOutraGrafia(
  gravado: string,
  doCliente: string | null | undefined,
): string | null {
  if (!doCliente || doCliente === gravado) return null;
  if (!JID_DE_TELEFONE.test(gravado) || !JID_DE_TELEFONE.test(doCliente)) return null;
  const digitosGravados = gravado.slice(0, gravado.indexOf('@'));
  const digitosDoCliente = doCliente.slice(0, doCliente.indexOf('@'));
  return variantesDoNonoDigito(digitosGravados).includes(digitosDoCliente)
    ? doCliente
    : null;
}
