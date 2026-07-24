// ============================================================
// Provisionamento de canal Meta (Cloud API oficial) para MÚLTIPLOS canais.
//
// Espelha o pipeline de POST /api/whatsapp/config (verify → register →
// subscribe), mas orquestra só as chamadas à Meta — a criptografia dos tokens
// e o insert em cb_channels ficam na rota. Reaproveita os helpers de
// @/lib/whatsapp/meta-api (a "estrutura Meta" existente, não tocada).
//
// register/subscribe são best-effort, exatamente como no fluxo original: sem
// PIN, pula o register (números de teste da Meta não têm 2FA a informar);
// falha de subscribe não bloqueia. `verify` é obrigatório — credencial
// inválida aborta ANTES de qualquer gravação.
// ============================================================

import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';

export interface MetaProvisionInput {
  phoneNumberId: string;
  wabaId?: string | null;
  /** Token EM TEXTO PLANO (a rota criptografa antes de gravar). */
  accessToken: string;
  pin?: string | null;
}

export interface MetaProvisionResult {
  phoneInfo: unknown;
  registeredAt: string | null;
  /** Mensagem de erro do /register (se falhou); vira cb_channels.last_error. */
  registrationError: string | null;
  /** register pulado por falta de PIN (não é erro — número de teste). */
  registrationSkipped: boolean;
  subscribedAppsAt: string | null;
}

/**
 * Valida a credencial na Meta e tenta registrar/assinar o número. LANÇA se o
 * `verify` falhar (credencial inválida → a rota devolve 400). register e
 * subscribe são best-effort e nunca lançam para fora.
 */
export async function provisionMetaChannel(
  input: MetaProvisionInput,
): Promise<MetaProvisionResult> {
  const { phoneNumberId, wabaId, accessToken, pin } = input;

  // verify — obrigatório. Lança → a rota traduz em 400.
  const phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken });

  // register — habilita o roteamento de webhook do número. Sem PIN, pula
  // (números de teste da Meta são pré-registrados e não expõem 2FA).
  let registeredAt: string | null = null;
  let registrationError: string | null = null;
  let registrationSkipped = false;
  if (!pin) {
    registrationSkipped = true;
  } else {
    try {
      await registerPhoneNumber({ phoneNumberId, accessToken, pin });
      registeredAt = new Date().toISOString();
    } catch (err) {
      registrationError =
        err instanceof Error ? err.message : 'Erro desconhecido da Meta';
      console.error('[meta-admin] register falhou:', registrationError);
    }
  }

  // subscribe do WABA ao app — idempotente na Meta. Best-effort.
  let subscribedAppsAt: string | null = null;
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken });
      subscribedAppsAt = new Date().toISOString();
    } catch (err) {
      console.warn(
        '[meta-admin] subscribe WABA falhou (não-fatal):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    phoneInfo,
    registeredAt,
    registrationError,
    registrationSkipped,
    subscribedAppsAt,
  };
}
