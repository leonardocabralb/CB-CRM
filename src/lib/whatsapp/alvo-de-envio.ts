import { ehMeta, type ComTransporte } from '@/lib/cb-channels/transporte'
import { resolveContactSendTarget } from './wa-identity'

// ============================================================
// Para onde vai o envio a um contato — telefone OU BSUID (Fase 11.3).
//
// A Meta deixou de mandar o telefone de quem adotou nome de usuário (#519): a
// ficha dessa pessoa tem só o `wa_user_id` (o BSUID), e a Cloud API a alcança
// pelo campo `recipient` (o `recipientFields` de `meta-api.ts` escolhe pelo
// FORMATO do alvo). O original resolve isso com `resolveContactSendTarget`
// (`wa-identity.ts`, do upstream, intacto); o que é NOSSO é o TRANSPORTE:
//
//   · telefone válido vale em qualquer transporte (e é preferido: só ele tem
//     a retentativa das variantes do nono dígito);
//   · o BSUID SÓ na API oficial da Meta. A Evolution (QR Code) endereça por
//     JID de telefone — com o BSUID, `toEvolutionNumber` tiraria as letras e
//     mandaria a mensagem para o número formado pelos dígitos dele;
//   · `wa_parent_user_id` nunca é alvo (é o portfólio, não a pessoa).
//
// Quem chama decide o alvo DEPOIS de resolver o canal e das recusas dele
// (Instagram, grupo, conexão incompleta): é o canal que diz se o BSUID serve.
// ============================================================

export type MotivoSemAlvo =
  /** Nem telefone válido nem BSUID: não há para onde mandar. */
  | 'sem_alvo'
  /** Só o BSUID, e o canal não é a API oficial da Meta. */
  | 'so_numero_oficial'

export type AlvoDeEnvio =
  | {
      ok: true
      /** O `to` que o remetente recebe: telefone sanitizado ou o BSUID. */
      alvo: string
      /**
       * `true` = telefone. Só ele tem variantes do nono dígito e a
       * autocorreção do telefone da ficha depois de um 131030 — um BSUID é
       * opaco, tem UMA grafia, e jamais pode ir para `contacts.phone`.
       */
      ehTelefone: boolean
    }
  | { ok: false; motivo: MotivoSemAlvo }

export function alvoDeEnvio(
  contato: { phone?: string | null; wa_user_id?: string | null } | null | undefined,
  canal: ComTransporte,
): AlvoDeEnvio {
  const alvo = resolveContactSendTarget(contato)
  if (!alvo) return { ok: false, motivo: 'sem_alvo' }
  if (alvo.isPhone) return { ok: true, alvo: alvo.target, ehTelefone: true }
  if (!ehMeta(canal)) return { ok: false, motivo: 'so_numero_oficial' }
  return { ok: true, alvo: alvo.target, ehTelefone: false }
}

/** A frase de quando o contato só tem o BSUID e o canal não é o oficial. */
export const FRASE_SO_NUMERO_OFICIAL =
  'Este contato não tem telefone: o WhatsApp o identifica só pelo nome de usuário, e só o número oficial (API da Meta) consegue responder a ele. Troque o canal desta conversa para o número oficial.'

/**
 * Modelo de AUTENTICAÇÃO (código de acesso: copiar código, um toque, sem
 * toque) só vai a TELEFONE: a documentação da Meta sobre BSUID o exclui do
 * envio por `recipient`. Recusar antes da Meta dá ao operador a frase certa em
 * vez do erro cru dela. Sem linha local (categoria desconhecida) não recusa —
 * não se sabe, e a Meta decide. Comparação sem caixa: a sincronização grava
 * `'Authentication'`, e a Meta devolve `'AUTHENTICATION'`.
 */
export function modeloExigeTelefone(
  modelo: { category?: string | null } | null | undefined,
): boolean {
  return String(modelo?.category ?? '').toUpperCase() === 'AUTHENTICATION'
}

/** A frase da recusa do modelo de autenticação a quem só tem o BSUID. */
export const FRASE_MODELO_DE_AUTENTICACAO =
  'Modelos de autenticação (código de acesso) só podem ser enviados a um número de telefone, e este contato é identificado apenas pelo nome de usuário do WhatsApp.'

/**
 * O mesmo `alvoDeEnvio` para os remetentes do ROBÔ (fluxo, IA e automação,
 * nos dois `meta-send.ts`), com a recusa virando `Error` no idioma do motor —
 * inglês, como as mensagens irmãs: o motivo cru fica no registro da execução.
 *
 * É `Error` comum de propósito: a retentativa das automações só repete
 * `EvolutionApiError` 4xx, e contato sem destino é erro de dado, que repetir
 * não conserta (`.claude/rules/automacoes.md`, "retentativa").
 */
export function alvoDoRobo(
  contato: { phone?: string | null; wa_user_id?: string | null },
  canal: ComTransporte,
): { alvo: string; ehTelefone: boolean } {
  const r = alvoDeEnvio(contato, canal)
  if (r.ok) return { alvo: r.alvo, ehTelefone: r.ehTelefone }
  if (r.motivo === 'so_numero_oficial') {
    throw new Error(
      'contact has no phone number — WhatsApp identifies it only by username, and only an official Meta number can reach it (this step went out through a QR Code / Evolution connection)',
    )
  }
  if (!contato.phone) {
    // Sem telefone e sem BSUID: pelo CHECK da 1041, é a ficha só do Instagram.
    throw new Error(
      'contact has no phone number (Instagram-only contact) — flows and automations do not send on Instagram (v1)',
    )
  }
  throw new Error(`contact phone invalid: ${contato.phone}`)
}
