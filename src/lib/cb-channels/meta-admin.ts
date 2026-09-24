// ============================================================
// Provisionamento de canal Meta (Cloud API oficial) para MÚLTIPLOS canais.
//
// Orquestra só as chamadas à Meta — a criptografia dos tokens e o insert em
// cb_channels ficam na rota (`POST /api/cb/channels`). Reaproveita os helpers
// de @/lib/whatsapp/meta-api e a classificação de erro do original
// (`explainMetaError`, #505), que a rota devolve como `FalhaDaMeta` para a
// tela traduzir.
//
// A ordem é a do #505 (Fase 7 do plano do merge do upstream):
//   1. verify — obrigatório. Credencial inválida aborta antes de gravar.
//   2. par WABA/número — com WABA informada, o número tem de estar entre os
//      que a Meta lista sob ela. Uma WABA válida de OUTRA conta salvava e
//      assinava a conta errada: o webhook nunca chegava, dias depois, sem
//      erro nenhum na tela.
//   3. register — best-effort, como sempre foi: sem PIN, pula (número de
//      teste da Meta não tem 2FA); falha fica em `registrationError` e a
//      conexão é salva para o operador tentar de novo com o PIN certo.
//   4. subscribe da WABA ao app — FATAL desde a Fase 7. Era engolido com um
//      console.warn e a conexão nascia "conectada" sem a Meta entregar nada.
//      Nada foi gravado ainda; o register (idempotente) não deixa órfão.
// ============================================================

import {
  listWabaPhoneNumbers,
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';
import { explainMetaError, type MetaConnectStep } from '@/lib/whatsapp/meta-error-explain';
import { phoneNumberBelongsToWaba } from '@/lib/whatsapp/waba-pairing';
import {
  falhaDaExplicacao,
  falhaDeNumeroForaDaWaba,
  type FalhaDaMeta,
} from '@/lib/cb-channels/falha-da-meta';

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
  /** A mensagem da Meta no /register (sem o token); vira cb_channels.last_error. */
  registrationError: string | null;
  /** O mesmo erro, classificado, para a tela explicar (null sem erro). */
  registrationFalha: FalhaDaMeta | null;
  /** register pulado por falta de PIN (não é erro — número de teste). */
  registrationSkipped: boolean;
  subscribedAppsAt: string | null;
}

/** Falha que aborta a conexão ANTES de qualquer gravação. */
export class ErroNaConexaoMeta extends Error {
  readonly falha: FalhaDaMeta;
  constructor(falha: FalhaDaMeta) {
    super(falha.mensagemDaMeta ?? falha.motivo);
    this.name = 'ErroNaConexaoMeta';
    this.falha = falha;
  }
}

/**
 * Valida a credencial e o par WABA/número na Meta, registra (best-effort) e
 * assina a WABA. LANÇA `ErroNaConexaoMeta` quando a conexão não pode ser
 * gravada; o erro do register volta no resultado.
 */
export async function provisionMetaChannel(
  input: MetaProvisionInput,
): Promise<MetaProvisionResult> {
  const { phoneNumberId, accessToken, pin } = input;
  const wabaId = input.wabaId ?? null;
  const ids = { phoneNumberId, wabaId };

  const falhaEm = (err: unknown, etapa: MetaConnectStep): FalhaDaMeta =>
    falhaDaExplicacao(explainMetaError(err, etapa, ids), ids, accessToken);
  const abortar = (falha: FalhaDaMeta): never => {
    console.error('[meta-admin] conexão abortada:', falha.etapa, falha.motivo, {
      codigo: falha.codigo,
      subcodigo: falha.subcodigo,
      fbtrace_id: falha.fbtraceId,
      mensagem: falha.mensagemDaMeta,
    });
    throw new ErroNaConexaoMeta(falha);
  };

  // 1. verify — obrigatório.
  let phoneInfo: unknown;
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken });
  } catch (err) {
    return abortar(falhaEm(err, 'verify_number'));
  }

  // 2. o número mora nesta WABA?
  if (wabaId) {
    let numeros;
    try {
      numeros = await listWabaPhoneNumbers({ wabaId, accessToken });
    } catch (err) {
      return abortar(falhaEm(err, 'waba_phone_numbers'));
    }
    if (!phoneNumberBelongsToWaba(numeros, phoneNumberId)) {
      return abortar(falhaDeNumeroForaDaWaba(numeros, phoneNumberId, wabaId));
    }
  }

  // 3. register — habilita o roteamento de webhook do número. Sem PIN, pula
  // (números de teste da Meta são pré-registrados e não expõem 2FA).
  let registeredAt: string | null = null;
  let registrationError: string | null = null;
  let registrationFalha: FalhaDaMeta | null = null;
  let registrationSkipped = false;
  if (!pin) {
    registrationSkipped = true;
  } else {
    try {
      await registerPhoneNumber({ phoneNumberId, accessToken, pin });
      registeredAt = new Date().toISOString();
    } catch (err) {
      registrationFalha = falhaEm(err, 'register');
      registrationError = registrationFalha.mensagemDaMeta ?? registrationFalha.motivo;
      console.error('[meta-admin] register falhou:', registrationFalha.motivo, {
        codigo: registrationFalha.codigo,
        fbtrace_id: registrationFalha.fbtraceId,
        mensagem: registrationError,
      });
    }
  }

  // 4. subscribe do WABA ao app — idempotente na Meta, e FATAL.
  let subscribedAppsAt: string | null = null;
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken });
      subscribedAppsAt = new Date().toISOString();
    } catch (err) {
      return abortar(falhaEm(err, 'subscribe_waba'));
    }
  }

  return {
    phoneInfo,
    registeredAt,
    registrationError,
    registrationFalha,
    registrationSkipped,
    subscribedAppsAt,
  };
}
